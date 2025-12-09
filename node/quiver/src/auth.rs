use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::env;
use utoipa::ToSchema;

const JWT_SECRET_ENV: &str = "JWT_SECRET";
// In a production environment, this secret should be loaded from environment variables
// and be a strong, randomly generated key. Do NOT use this default in production.
const DEFAULT_SECRET: &str = "quiver_secret_key";

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub enum Scope {
    Connection,
    Statement,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Claims {
    pub res_id: String,            // The Resource ID (Connection or Statement ID)
    pub scope: Scope,              // What kind of resource is this?
    pub parent_id: Option<String>, // The ID of the parent resource (Database for Connection, Connection for Statement)
    pub exp: usize,                // Expiration timestamp
}

#[derive(Debug)]
pub enum AuthError {
    WrongCredentials,
    MissingCredentials,
    TokenCreation,
    InvalidToken,
    WrongScope,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AuthError::WrongCredentials => (StatusCode::UNAUTHORIZED, "Wrong credentials"),
            AuthError::MissingCredentials => (StatusCode::BAD_REQUEST, "Missing credentials"),
            AuthError::TokenCreation => {
                (StatusCode::INTERNAL_SERVER_ERROR, "Token creation failed")
            }
            AuthError::InvalidToken => (StatusCode::UNAUTHORIZED, "Invalid token"),
            AuthError::WrongScope => (
                StatusCode::FORBIDDEN,
                "Token has wrong scope for this endpoint",
            ),
        };
        let body = axum::Json(serde_json::json!({
            "error": error_message,
        }));
        (status, body).into_response()
    }
}

pub fn sign_token(
    res_id: String,
    scope: Scope,
    parent_id: Option<String>,
) -> Result<String, AuthError> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::hours(24))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        res_id,
        scope,
        parent_id,
        exp: expiration as usize,
    };

    let secret = env::var(JWT_SECRET_ENV).unwrap_or_else(|_| DEFAULT_SECRET.to_string());

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| AuthError::TokenCreation)
}

// --- Extractors ---

pub struct ConnectionClaims {
    pub connection_id: String,
    pub _database_id: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for ConnectionClaims
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let claims = extract_claims(parts).await?;
        if claims.scope != Scope::Connection {
            return Err(AuthError::WrongScope);
        }
        let database_id = claims.parent_id.ok_or(AuthError::MissingCredentials)?;
        Ok(ConnectionClaims {
            connection_id: claims.res_id,
            _database_id: database_id,
        })
    }
}

pub struct StatementClaims {
    pub statement_id: String,
    pub _connection_id: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for StatementClaims
where
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let claims = extract_claims(parts).await?;
        if claims.scope != Scope::Statement {
            return Err(AuthError::WrongScope);
        }
        let connection_id = claims.parent_id.ok_or(AuthError::MissingCredentials)?;
        Ok(StatementClaims {
            statement_id: claims.res_id,
            _connection_id: connection_id,
        })
    }
}

async fn extract_claims(parts: &mut Parts) -> Result<Claims, AuthError> {
    let auth_header = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(AuthError::MissingCredentials)?;

    let auth_header = auth_header
        .to_str()
        .map_err(|_| AuthError::WrongCredentials)?;

    if !auth_header.starts_with("Bearer ") {
        return Err(AuthError::WrongCredentials);
    }

    let token = &auth_header[7..];
    let secret = env::var(JWT_SECRET_ENV).unwrap_or_else(|_| DEFAULT_SECRET.to_string());

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AuthError::InvalidToken)?;

    Ok(token_data.claims)
}
