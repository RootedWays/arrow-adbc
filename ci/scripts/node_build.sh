set -e

# Usage: ./node_build.sh <out_dir>
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <out_dir>"
  exit 1
fi

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
OUT_DIR="$1"

# 1. Build the C++ Drivers
echo "=== Building C++ Drivers ==="
mkdir -p "${OUT_DIR}"

cmake -S "${REPO_ROOT}/c" -B "${OUT_DIR}" \
  ${ADBC_CMAKE_ARGS} \
  -DCMAKE_INSTALL_PREFIX="${OUT_DIR}" \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DADBC_DRIVER_SQLITE=ON \
  -DADBC_BUILD_TESTS=OFF \
  -DADBC_BUILD_SHARED=ON

cmake --build "${OUT_DIR}" --target install -j

# 2. Build Node.js Package
echo "=== Building Node.js Package ==="
pushd "${REPO_ROOT}/node"

npm install
npm run build

popd
