# wasi-nn on Propeller

Running machine learning inference on edge devices has traditionally required platform-specific binaries and complex deployment pipelines. This is where WebAssembly comes in. WebAssembly provides a portable, sandboxed execution environment that runs consistently across different hardware.

wasi-nn (WebAssembly System Interface for Neural Networks) is a standard API that allows WebAssembly programs to perform ML inference. It abstracts the underlying ML framework, so your application code stays the same whether you're using OpenVINO, ONNX Runtime, or TensorFlow Lite. The backend handles platform-specific optimizations automatically.

These examples demonstrate how to run wasi-nn workloads on [Propeller](https://github.com/absmach/propeller), a distributed WASM execution platform. Propeller orchestrates WASM workloads across edge devices, providing task scheduling, monitoring, and result collection. Combined with wasi-nn, you get portable ML inference that can be deployed, scheduled, and scaled across your device fleet.

Currently Propeller supports running wasi-nn workloads using the external runtime mode, where the proplet spawns wasmtime as a subprocess with wasi-nn enabled. The Propeller Docker image comes pre-built with wasmtime v39.0.1 and OpenVINO 2025.4.0.

## Table of Contents

- [How wasi-nn Works](#how-wasi-nn-works)
- [Propeller Integration](#propeller-integration)
- [Prerequisites](#prerequisites)
- [Examples](#examples)
  - [Image Classification (MobileNet)](#image-classification-mobilenet)
  - [ONNX Classification](#onnx-classification)
- [Running on Propeller](#running-on-propeller)
- [Troubleshooting](#troubleshooting)
- [References](#references)

## How wasi-nn Works

wasi-nn provides a simple four-step API for ML inference:

| Operation  | Function                    | Description                                   |
| ---------- | --------------------------- | --------------------------------------------- |
| Load       | `wasi_nn::load()`           | Load model files (graph definition + weights) |
| Initialize | `init_execution_context()`  | Create inference context from loaded graph    |
| Execute    | `set_input()` + `compute()` | Bind input tensor and run inference           |
| Retrieve   | `get_output()`              | Extract output tensor with predictions        |

[Propeller Architecture](./images/wasi-nn-proplet.png)

### Supported Backends

| Backend      | Model Format    | Status | Notes                             |
| ------------ | --------------- | ------ | --------------------------------- |
| OpenVINO     | `.xml` + `.bin` | Tested | Primary backend, best performance |
| ONNX Runtime | `.onnx`         | Tested | Wide model compatibility          |
| PyTorch      | `.pt`           | WIP    | Requires additional setup         |

## Propeller Integration

### Execution Flow

When you submit a wasi-nn task to Propeller, here's what happens:

I

1. **Task Creation**: You create a task with `cli_args` specifying wasi-nn flags (`-S nn`)
2. **Task Distribution**: Manager receives the task and publishes it to the Proplet via MQTT
3. **WASM Execution**: Proplet writes the WASM binary to a temp file and spawns wasmtime
4. **Inference**: wasmtime loads the module with `-S nn`, OpenVINO runs inference
5. **Results**: Output flows back through stdout → Proplet → Manager → API

### Why External Runtime?

Propeller supports two execution modes:

| Runtime  | How it works                          | wasi-nn Support |
| -------- | ------------------------------------- | --------------- |
| Embedded | WASM runs inside proplet process      | ❌ No           |
| External | Proplet spawns wasmtime as subprocess | ✅ Yes          |

wasi-nn requires external runtime because:

- **Command-line flags**: wasi-nn needs the `-S nn` flag to activate
- **Environment variables**: OpenVINO requires `LD_LIBRARY_PATH` to find libraries
- **Isolation**: Subprocess model provides better fault isolation

### Pre-built Docker Image

The Propeller Docker image (`ghcr.io/absmach/propeller/proplet:latest`) includes everything needed:

| Component       | Version  | Location                                       |
| --------------- | -------- | ---------------------------------------------- |
| wasmtime        | v39.0.1  | `/usr/local/bin/wasmtime`                      |
| OpenVINO        | 2025.4.0 | `/opt/intel/openvino_2025`                     |
| LD_LIBRARY_PATH | Set      | `/opt/intel/openvino_2025/runtime/lib/intel64` |

When you set `PROPLET_EXTERNAL_WASM_RUNTIME=wasmtime`, the proplet finds and uses this pre-installed binary.

**Note:** OpenVINO only works on x86_64. On Apple Silicon, Docker runs it through x86 emulation (Rosetta 2).

## Prerequisites

### Install Rust and WASM Target

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WebAssembly target
rustup target add wasm32-wasip1

# Verify installation
rustc --version
rustup target list | grep wasm32-wasip1
```

### Install wasmtime (for local testing)

```bash
# Unix/macOS
curl https://wasmtime.dev/install.sh -sSf | bash

# Verify installation
wasmtime --version
```

Verify wasi-nn support:

```bash
wasmtime run -S help | grep nn
```

Expected output:

```text
-S nn[=y|n] -- Enable support for WASI neural network imports
```

If wasi-nn is not available, build from source:

```bash
git clone https://github.com/bytecodealliance/wasmtime.git
cd wasmtime
cargo build --release --features wasi-nn
# Binary at: target/release/wasmtime
```

### Install OpenVINO (for local testing)

**Linux:**

```bash
# Download and install
wget https://storage.openvinotoolkit.org/repositories/openvino/packages/2024.0/linux/l_openvino_toolkit_ubuntu22_2024.0.0.14509.34caeefd078_x86_64.tgz
tar -xzf l_openvino_toolkit_*.tgz
sudo mv l_openvino_toolkit_* /opt/intel/openvino_2024

# Set library path
export LD_LIBRARY_PATH=/opt/intel/openvino_2024/runtime/lib/intel64:$LD_LIBRARY_PATH

# Verify
ls /opt/intel/openvino_2024/runtime/lib/intel64 | grep openvino
```

**macOS (Homebrew):**

```bash
brew install openvino

# Set library path (Apple Silicon)
export DYLD_LIBRARY_PATH=/opt/homebrew/lib:$DYLD_LIBRARY_PATH

# Set library path (Intel)
# export DYLD_LIBRARY_PATH=/usr/local/lib:$DYLD_LIBRARY_PATH

# Verify
ls /opt/homebrew/lib | grep openvino
```

### Clone Example Repository

```bash
git clone https://github.com/bytecodealliance/wasmtime.git
cd wasmtime/crates/wasi-nn/examples
ls -la
```

Expected output:

```text
classification-example/          # MobileNet with OpenVINO
classification-component-onnx/   # ONNX Runtime example
classification-example-pytorch/  # PyTorch example (WIP)
```

## Examples

The following examples are available:

- [x] Image Classification (MobileNet + OpenVINO)
- [x] ONNX Classification (ONNX Runtime)
- [ ] PyTorch Classification (Work in Progress)

### Image Classification (MobileNet)

This example uses MobileNet v2 with the OpenVINO backend to classify images. MobileNet is a lightweight CNN optimized for mobile and edge devices.

**Model Details:**

| Property     | Value                     |
| ------------ | ------------------------- |
| Architecture | MobileNet v2              |
| Input Shape  | 1x224x224x3 (NHWC)        |
| Output       | 1001 classes (ImageNet)   |
| Model Format | OpenVINO IR (.xml + .bin) |
| Size         | ~14 MB                    |

#### Build the WASM Binary

Navigate to the example directory and build:

```bash
cd wasmtime/crates/wasi-nn/examples/classification-example
cargo build --target wasm32-wasip1 --release
```

Verify the output:

```bash
ls -lh target/wasm32-wasip1/release/wasi-nn-example.wasm
```

Expected output:

```text
-rwxr-xr-x  1 user  staff   2.1M Jan 27 10:00 wasi-nn-example.wasm
```

#### Download Model Files

Create fixture directory and download MobileNet model:

```bash
mkdir -p fixture
cd fixture

# Download model definition (XML)
curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.xml

# Download model weights (BIN)
curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.bin

# Rename to expected names
mv mobilenet.xml model.xml
mv mobilenet.bin model.bin

# Download test input tensor (preprocessed image data)
curl -LO https://download.01.org/openvinotoolkit/fixtures/mobilenet/tensor-1x224x224x3-f32.bgr

cd ..
```

Verify all files:

```bash
ls -lh fixture/
```

Expected output:

```text
-rw-r--r--  1 user  staff    14M Jan 27 10:05 model.bin
-rw-r--r--  1 user  staff   269K Jan 27 10:05 model.xml
-rw-r--r--  1 user  staff   588K Jan 27 10:05 tensor-1x224x224x3-f32.bgr
```

#### Run Locally

Set the library path and run:

```bash
# Linux
export LD_LIBRARY_PATH=/opt/intel/openvino_2024/runtime/lib/intel64:$LD_LIBRARY_PATH

# macOS Apple Silicon
# export DYLD_LIBRARY_PATH=/opt/homebrew/lib:$DYLD_LIBRARY_PATH

# Run inference
wasmtime run -S nn --dir=fixture target/wasm32-wasip1/release/wasi-nn-example.wasm
```

Expected output:

```text
Read graph XML, first 50 characters: <?xml version="1.0" ?>
<net name="mobilenet_v2_1.0
Read graph weights, size in bytes: 13956476
Loaded graph into wasi-nn with ID: 0
Created wasi-nn execution context with ID: 0
Read input tensor, size in bytes: 602112
Executed graph inference
Found results, sorted top 5: [InferenceResult(904, 0.4025879), InferenceResult(885, 0.3581543), InferenceResult(653, 0.0658493), InferenceResult(543, 0.0298767), InferenceResult(907, 0.0182349)]
```

**Understanding the Results:**

| Class ID | Probability | ImageNet Label     |
| -------- | ----------- | ------------------ |
| 904      | 40.26%      | Cardigan (sweater) |
| 885      | 35.82%      | Velvet             |
| 653      | 6.58%       | Military uniform   |
| 543      | 2.99%       | Drumstick          |
| 907      | 1.82%       | Windsor tie        |

### ONNX Classification

This example uses ONNX Runtime as the backend instead of OpenVINO.

#### Build ONNX WASM Binary

```bash
cd wasmtime/crates/wasi-nn/examples/classification-component-onnx
cargo build --target wasm32-wasip1 --release
```

Verify the output:

```bash
ls -lh target/wasm32-wasip1/release/*.wasm
```

#### Download ONNX Model

```bash
mkdir -p fixture
cd fixture

# Download SqueezeNet ONNX model
curl -LO https://github.com/onnx/models/raw/main/validated/vision/classification/squeezenet/model/squeezenet1.0-8.onnx

cd ..
```

#### Run ONNX Example Locally

```bash
wasmtime run -S nn --dir=fixture target/wasm32-wasip1/release/classification-component-onnx.wasm
```

## Running on Propeller

This section shows how to deploy wasi-nn workloads to Propeller.

### 1. Configure Propeller

Navigate to your Propeller directory and provision MQTT credentials:

```bash
cd /path/to/propeller
propeller-cli provision
```

This generates a `config.toml` file with credentials. Update your `.env` file:

```bash
# Proplet Configuration
PROPLET_DOMAIN_ID="<domain_id from config.toml>"
PROPLET_CHANNEL_ID="<channel_id from config.toml>"
PROPLET_CLIENT_ID="<client_id from config.toml>"
PROPLET_CLIENT_KEY="<client_key from config.toml>"

# Enable external runtime for wasi-nn
PROPLET_EXTERNAL_WASM_RUNTIME="wasmtime"
```

### 2. Configure Volume Mounts

Update `compose.yaml` to mount your model files:

```yaml
proplet:
  image: ghcr.io/absmach/propeller/proplet:latest
  container_name: propeller-proplet
  restart: on-failure
  environment:
    PROPLET_LOG_LEVEL: ${PROPLET_LOG_LEVEL}
    PROPLET_MQTT_ADDRESS: ${PROPLET_MQTT_ADDRESS}
    PROPLET_DOMAIN_ID: ${PROPLET_DOMAIN_ID}
    PROPLET_CHANNEL_ID: ${PROPLET_CHANNEL_ID}
    PROPLET_CLIENT_ID: ${PROPLET_CLIENT_ID}
    PROPLET_CLIENT_KEY: ${PROPLET_CLIENT_KEY}
    PROPLET_EXTERNAL_WASM_RUNTIME: ${PROPLET_EXTERNAL_WASM_RUNTIME}
  volumes:
    # Mount model files from host into container
    - ./fixture:/home/proplet/fixture
  networks:
    - propeller-net
```

**Understanding Directory Mapping:**

For your WASM module to access model files, two mappings are required:

| Layer            | Mapping                                           | Purpose                                      |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| Host → Container | `./fixture:/home/proplet/fixture`                 | Makes model files accessible in container    |
| Container → WASM | `--dir=/home/proplet/fixture::fixture` (cli_args) | Makes files accessible to WASM as `fixture/` |

### 3. Start Services

```bash
docker compose up -d

# Wait for services to start
sleep 10

# Verify proplet registered with manager
docker compose logs manager | grep "successfully created proplet"
```

Expected output:

```text
{"level":"INFO","msg":"successfully created proplet","proplet_id":"..."}
```

### 4. Create Task

**Understanding cli_args:**

| Flag                                   | Purpose                                  |
| -------------------------------------- | ---------------------------------------- |
| `-S nn`                                | Enables wasi-nn support in wasmtime      |
| `--dir=/home/proplet/fixture::fixture` | Maps container path to WASM sandbox path |

#### Option A: Using curl

```bash
# Create task with cli_args
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mobilenet-inference",
    "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]
  }'
```

Sample response:

```json
{
  "id": "3fc0a69a-6c1c-4944-bd71-1117e9ddcf31",
  "name": "mobilenet-inference",
  "state": 0,
  "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"],
  "created_at": "2026-01-27T10:30:00Z"
}
```

Save the task ID:

```bash
TASK_ID="3fc0a69a-6c1c-4944-bd71-1117e9ddcf31"
```

Upload the WASM binary:

```bash
curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \
  -F "file=@target/wasm32-wasip1/release/wasi-nn-example.wasm"
```

Start the task:

```bash
curl -X POST "http://localhost:7070/tasks/${TASK_ID}/start"
```

Sample response:

```json
{ "started": true }
```

#### Option B: Using Propeller CLI

```bash
# Create task with cli_args
propeller-cli tasks create mobilenet-inference \
  --cli-args="-S,nn,--dir=/home/proplet/fixture::fixture"

# Get task ID from output
TASK_ID="<id-from-output>"

# Upload WASM binary
curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \
  -F "file=@target/wasm32-wasip1/release/wasi-nn-example.wasm"

# Start task
propeller-cli tasks start $TASK_ID
```

### 5. Monitor Execution

View proplet logs:

```bash
docker compose logs proplet --tail 100
```

Expected log entries:

```text
{"level":"INFO","msg":"Executing task","task_id":"3fc0a69a-..."}
{"level":"INFO","msg":"Task completed","task_id":"3fc0a69a-...","exit_code":0}
```

### 6. Retrieve Results

```bash
curl -s http://localhost:7070/tasks/$TASK_ID | jq '.results'
```

Expected output:

```text
"Read graph XML, first 50 characters: <?xml version=\"1.0\" ?>
<net name=\"mobilenet_v2_1.0
Read graph weights, size in bytes: 13956476
Loaded graph into wasi-nn with ID: 0
Created wasi-nn execution context with ID: 0
Read input tensor, size in bytes: 602112
Executed graph inference
Found results, sorted top 5: [InferenceResult(885, 0.3958259), InferenceResult(904, 0.36464667), ...]"
```

## Platform Notes

| Platform              | Library Path Var    | Base64 Flag | OpenVINO Path                             |
| --------------------- | ------------------- | ----------- | ----------------------------------------- |
| Linux                 | `LD_LIBRARY_PATH`   | `-w 0`      | `/opt/intel/openvino/runtime/lib/intel64` |
| macOS (Intel)         | `DYLD_LIBRARY_PATH` | `-i`        | `/usr/local/lib`                          |
| macOS (Apple Silicon) | `DYLD_LIBRARY_PATH` | `-i`        | `/opt/homebrew/lib`                       |

### Linux Notes

- Use `LD_LIBRARY_PATH` for OpenVINO libraries
- Base64 uses `-w 0` flag for no line wrapping
- Ensure model files have proper permissions: `chmod -R 755 fixture/`

### macOS Notes

- Use `DYLD_LIBRARY_PATH` (not `LD_LIBRARY_PATH`)
- Base64 requires `-i` flag; the `-w` flag doesn't exist on macOS
- Docker platform warning about linux/amd64 vs linux/arm64 is normal (uses Rosetta 2)
- OpenVINO runs through x86 emulation on Apple Silicon

## Troubleshooting

### wasi-nn module not recognized

**Symptom:**

```text
Error: unknown flag: -S
```

or

```text
Error: unknown flag: --wasi-modules
```

**Cause:** Wasmtime version doesn't support the flag syntax, or wasi-nn feature not compiled in.

**Solution:**

```bash
# Check wasmtime version
wasmtime --version

# Check available WASI options
wasmtime run -S help | grep nn

# Wasmtime 14.0+: use -S nn
# Wasmtime 0.40-13.x: use --wasi-modules=experimental-wasi-nn

# If not present, rebuild wasmtime with wasi-nn:
cd /path/to/wasmtime
cargo build --release --features wasi-nn
```

### Model files not found

**Symptom:**

```text
Error: failed to load model: file not found
```

or

```text
Error: failed to open fixture/model.xml
```

**Cause:** Model files not accessible to the WASM module, or incorrect path mapping.

**Solution:**

```bash
# Verify model files exist locally
ls -lh fixture/model.xml fixture/model.bin

# Verify volume mounts in compose.yaml
docker compose config | grep -A 5 volumes

# Check proplet can access files inside container
docker compose exec proplet ls -la /home/proplet/fixture

# Ensure --dir flag is included in cli_args
# cli_args: ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]
```

### OpenVINO backend not available

**Symptom:**

```text
Error: Failed while accessing backend
```

or

```text
Error: backend not available
```

**Cause:** OpenVINO libraries not found or not in library path.

**Solution:**

```bash
# Linux: Verify OpenVINO installation
ldconfig -p | grep openvino
export LD_LIBRARY_PATH=/opt/intel/openvino/runtime/lib/intel64:$LD_LIBRARY_PATH

# macOS: Verify OpenVINO installation
ls /opt/homebrew/lib | grep openvino
export DYLD_LIBRARY_PATH=/opt/homebrew/lib:$DYLD_LIBRARY_PATH

# Test locally before deploying to Propeller
wasmtime run -S nn --dir=fixture wasi-nn-example.wasm
```

### Failed to spawn host runtime process

**Symptom:**

```text
ERROR Task failed: Failed to spawn host runtime process: . Command: []
```

**Cause:** The `PROPLET_EXTERNAL_WASM_RUNTIME` environment variable is not set.

**Solution:**

```bash
# Add to .env file
PROPLET_EXTERNAL_WASM_RUNTIME="wasmtime"

# Recreate proplet to pick up the change
docker compose up -d --force-recreate proplet
```

### wasi-nn import not defined

**Symptom:**

```text
Error: failed to run main module
Caused by:
    0: failed to instantiate "..."
    1: unknown import: `wasi_ephemeral_nn::get_output` has not been defined
```

**Cause:** Task is missing the `-S nn` flag in cli_args.

**Solution:**

Create a new task with correct cli_args (cli_args cannot be changed after creation):

```bash
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "wasi-nn-demo",
    "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]
  }'
```

### File or image_url required

**Symptom:**

```text
ERROR Error handling message: either file or image_url must be provided
```

**Cause:** Task was created but WASM binary was not uploaded before starting.

**Solution:**

```bash
# Upload WASM binary first
curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \
  -F "file=@target/wasm32-wasip1/release/wasi-nn-example.wasm"

# Then start the task
curl -X POST "http://localhost:7070/tasks/${TASK_ID}/start"
```

### Volume mount failures

**Symptom:**

```text
Error: not a directory
```

or files not accessible inside container.

**Cause:** Incorrect volume mount syntax or relative paths not resolving correctly.

**Solution:**

```yaml
# Use ABSOLUTE paths in compose.yaml
volumes:
  - /home/user/fixture:/home/proplet/fixture    # ✅ Correct
  - ~/fixture:/home/proplet/fixture              # ❌ May not work (tilde expansion)
  - ./fixture:/home/proplet/fixture              # ⚠️ Depends on working directory

# Verify mounts are working
docker compose exec proplet ls -la /home/proplet/fixture
```

## References

- [wasi-nn Specification](https://github.com/WebAssembly/wasi-nn) - Official WASI neural network proposal
- [Wasmtime wasi-nn](https://github.com/bytecodealliance/wasmtime/tree/main/crates/wasi-nn) - Wasmtime implementation
- [OpenVINO](https://docs.openvino.ai/) - Intel's ML inference toolkit
- [ONNX Runtime](https://onnxruntime.ai/) - Cross-platform ML inference
- [Propeller Documentation](https://docs.propeller.absmach.eu/) - Propeller user guide
- [SuperMQ Documentation](https://docs.supermq.absmach.eu/) - MQTT infrastructure
