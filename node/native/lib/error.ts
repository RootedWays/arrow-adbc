/**
 * Structured error class for ADBC operations.
 */
export class AdbcError extends Error {
    code: string;
    vendorCode?: number;
    sqlState?: string;
  
    constructor(message: string, code: string, vendorCode?: number, sqlState?: string) {
      super(message);
      this.name = 'AdbcError';
      this.code = code;
      this.vendorCode = vendorCode;
      this.sqlState = sqlState;
    }
  
    /**
     * Parses a raw error message from the native binding into a structured AdbcError.
     * Expected format: "[STATUS] Message (Vendor Code: X, SQL State: Y)"
     * 
     * If the error does not match this specific format (e.g. it is a standard JS TypeError),
     * the original error is returned unmodified.
     */
    static fromError(err: any): any {
      if (err instanceof Error) {
         // Regex to match: [Status] Message (Vendor Code: 123, SQL State: XYZ)
         // Note: Message might contain parentheses, so we match strictly on the suffix.
         const match = err.message.match(/^\[(.*?)\] (.*) \(Vendor Code: (-?\d+), SQL State: (.*)\)$/s);
         
         if (match) {
           const [, status, msg, vendor, sqlState] = match;
           return new AdbcError(msg, status, Number(vendor), sqlState);
         }
      }
      return err;
    }
  }
