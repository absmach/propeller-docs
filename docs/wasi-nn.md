# Running wasi-nn on Propeller

This guide explains how to run machine learning inference on Propeller using wasi-nn with OpenVINO backend.

## What is wasi-nn?

**wasi-nn** (WebAssembly System Interface for Neural Networks) is a standard API that allows WebAssembly programs to perform ML inference. It provides four core operations:

| Operation  | Function                    | Description                                   |
| ---------- | --------------------------- | --------------------------------------------- |
| Load       | `wasi_nn::load()`           | Load model files (graph definition + weights) |
| Initialize | `init_execution_context()`  | Create inference context from loaded graph    |
| Execute    | `set_input()` + `compute()` | Bind input tensor and run inference           |
| Retrieve   | `get_output()`              | Extract output tensor with predictions        |

The benefit is portability: your application code stays the same while the underlying ML framework (OpenVINO, ONNX Runtime, TensorFlow Lite) handles platform-specific optimizations.

## How Propeller Executes wasi-nn Tasks

Propeller uses a **subprocess execution model** for wasi-nn workloads. Here's the flow:

1. **CLI/API** → Creates task with `cli_args` specifying wasi-nn flags
2. **Manager** → Receives task, publishes to Proplet via MQTT
3. **Proplet** → Receives WASM binary and task configuration
4. **HostRuntime** → Writes WASM to temp file, spawns `wasmtime` as subprocess
5. **wasmtime** → Loads WASM module with `-S nn` flag enabling wasi-nn
6. **OpenVINO** → Executes inference using model files
7. **Results** → Flow back through stdout → HostRuntime → Proplet → Manager

![Wasi-nn And Proplet Architecture](images/wasi-nn-proplet.png)

## Execution Model

Propeller supports two ways to run WebAssembly:

| Runtime  | How it works                          | wasi-nn Support |
| -------- | ------------------------------------- | --------------- |
| Embedded | WASM runs inside proplet process      | No              |
| External | Proplet spawns wasmtime as subprocess | Yes             |

For wasi-nn, the external runtime is required because:

- wasi-nn needs the `-S nn` command-line flag to activate
- OpenVINO needs environment variables like `LD_LIBRARY_PATH`
- The embedded runtime can't pass command-line flags

The Propeller Docker image includes everything needed for wasi-nn. During the image build process (defined in `Dockerfile.proplet`):

1. **wasmtime v39.0.1** is downloaded from the official GitHub releases and installed to `/usr/local/bin/wasmtime`:

   ```dockerfile
   wget https://github.com/bytecodealliance/wasmtime/releases/download/v39.0.1/wasmtime-v39.0.1-x86_64-linux.tar.xz
   ```

2. **OpenVINO 2025.4.0** is downloaded from Intel's repository and installed to `/opt/intel/openvino_2025`:

   ```dockerfile
   curl -L https://storage.openvinotoolkit.org/.../openvino_toolkit_ubuntu24_2025.4.0.*.tgz
   ```

3. **Environment variables** are set so wasmtime can find OpenVINO libraries:

   ```dockerfile
   ENV LD_LIBRARY_PATH=/opt/intel/openvino_2025/runtime/lib/intel64:${LD_LIBRARY_PATH}
   ```

When you set `PROPLET_EXTERNAL_WASM_RUNTIME=wasmtime`, the proplet looks for a binary named `wasmtime` in the system PATH. Since `/usr/local/bin` is in PATH and `/usr/local/bin/wasmtime` was installed during the image build, the proplet finds and uses this pre-installed binary to spawn inference tasks.

When a task runs: Proplet writes the WASM binary to a temp file → spawns `/usr/local/bin/wasmtime` with `-S nn` → wasmtime runs inference using the bundled OpenVINO libraries → results return to the Manager (as shown in illustration above).

**Note:** OpenVINO only works on x86_64. On Apple Silicon, Docker runs it through x86 emulation.

## Prerequisites

### Development Environment

Install Rust and add WebAssembly support to compile the example code:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasip1
```

Get the example code from the wasmtime repository:

```bash
git clone https://github.com/bytecodealliance/wasmtime.git
cd wasmtime/crates/wasi-nn/examples/classification-example
```

Install wasmtime locally for testing. This allows you to verify the WASM binary and model files work correctly before deploying to Propeller:

```bash
# Option 1: Build from source
cd wasmtime
cargo build --release --features wasi-nn

# Option 2: Check existing installation
wasmtime run -S help | grep nn
# Should show: -S nn[=y|n] -- Enable support for WASI neural network imports
```

### Propeller Worker Environment

The Propeller Docker image comes pre-built with:

- wasmtime v39.0.1 with wasi-nn support at `/usr/local/bin/wasmtime`
- OpenVINO 2025.4.0 libraries at `/opt/intel/openvino_2025`
- All necessary environment variables configured

You only need to configure the proplet to use the external runtime and mount your model files.

## Execution Steps

### Build the WASM Binary

Compile the example to WebAssembly:

```bash
cd wasmtime/crates/wasi-nn/examples/classification-example
cargo build --target wasm32-wasip1 --release
```

### Prepare Model Files

Download the MobileNet model and test input. OpenVINO models have two files: an XML definition and binary weights.

```bash
mkdir -p fixture && cd fixture

curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.xml
curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.bin
curl -LO https://download.01.org/openvinotoolkit/fixtures/mobilenet/tensor-1x224x224x3-f32.bgr

mv mobilenet.xml model.xml
mv mobilenet.bin model.bin
cd ..
```

### Test Locally

Run the example locally to verify everything works before deploying to Propeller:

```bash
export DYLD_LIBRARY_PATH=/opt/homebrew/lib  # macOS Apple Silicon
# export DYLD_LIBRARY_PATH=/usr/local/lib  # macOS Intel
# export LD_LIBRARY_PATH=/opt/intel/openvino/runtime/lib:$LD_LIBRARY_PATH  # Linux

wasmtime run -S nn --dir=fixture target/wasm32-wasip1/release/wasi-nn-example.wasm
```

Expected output:

```bash
Read graph XML, first 50 characters: <?xml version="1.0" ?>
<net name="mobilenet_v2_1.0
Read graph weights, size in bytes: 13956476
Loaded graph into wasi-nn with ID: 0
Created wasi-nn execution context with ID: 0
Read input tensor, size in bytes: 602112
Executed graph inference
Found results, sorted top 5: [InferenceResult(904, 0.4025879), ...]
```

### Configure Propeller

Create MQTT credentials for Propeller components to communicate[more details here](https://docs.propeller.absmach.eu/getting-started/#2-provision-supermq-with-propeller-cli):

Update `.env` with credentials from the generated `config.toml`:

```bash
PROPLET_DOMAIN_ID="<from-config.toml>"
PROPLET_CHANNEL_ID="<from-config.toml>"
PROPLET_CLIENT_ID="<from-config.toml>"
PROPLET_CLIENT_KEY="<from-config.toml>"
PROPLET_EXTERNAL_WASM_RUNTIME="wasmtime"
```

Configure `compose.yaml` to mount your model files:

```yaml
proplet:
  image: ghcr.io/absmach/propeller/proplet:latest
  environment:
    PROPLET_EXTERNAL_WASM_RUNTIME: ${PROPLET_EXTERNAL_WASM_RUNTIME}
  volumes:
    # Mount model files from host into container
    - ./fixture:/home/proplet/fixture
```

#### Start Services

```bash
docker compose up -d

# Wait for services to initialize
sleep 10

# Verify proplet registered with manager
docker compose logs manager | grep "successfully created proplet"
```

### 5. Submit Task

#### Task Structure

A Propeller task for wasi-nn includes:

```json
{
  "name": "wasi-nn-inference",
  "file": "<base64-encoded-wasm-binary>",
  "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]
}
```

> **Note:** The `cli_args` must be an array with separate elements. Do not combine multiple flags into a single string.

#### Submit via CLI and API

```bash
cd wasmtime/crates/wasi-nn/examples/classification-example

# Create task
propeller-cli tasks create wasi-nn-demo

# Save task ID from output
TASK_ID="<id-from-output>"

# Encode WASM binary to base64
# Linux:
WASM_B64=$(base64 -w 0 target/wasm32-wasip1/release/wasi-nn-example.wasm)

# macOS:
#WASM_B64=$(base64 -i target/wasm32-wasip1/release/wasi-nn-example.wasm | tr -d '\n')

```

#### Update Task with WASM Binary and Configuration

```bash
curl -X PUT http://localhost:7070/tasks/$TASK_ID \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"wasi-nn-demo\",
    \"file\": \"$WASM_B64\",
    \"cli_args\": [\"-S\", \"nn\", \"--dir=/home/proplet/fixture::fixture\"]
  }"
```

**Field Reference:**

| Field      | Required          | Description                              |
| ---------- | ----------------- | ---------------------------------------- |
| `name`     | Yes               | Task identifier                          |
| `file`     | Yes               | Base64-encoded WASM binary               |
| `cli_args` | Yes (for wasi-nn) | Arguments passed to wasmtime (see below) |

**Understanding `cli_args`:**

The `cli_args` array passes flags directly to the wasmtime CLI. For wasi-nn tasks, two flags are required:

- **`-S nn`**: Enables wasmtime's wasi-nn support. Without this, the WASM module fails with "unknown import: wasi_ephemeral_nn".

- **`--dir=/home/proplet/fixture::fixture`**: Maps a directory into the WASM sandbox. The format is `--dir=<container-path>::<guest-path>`. This allows the WASM module to access model files at the `fixture/` path.

**Directory Mapping (Two Layers):**

For the WASM module to access model files, you need both:

1. **Host → Container** (Docker volume mount above): Maps your local `./fixture` directory into the container at `/home/proplet/fixture`. This makes files accessible to the proplet.

   ```yaml
   volumes:
     - ./fixture:/home/proplet/fixture
   ```

   This makes your host `fixture/` directory available inside the container at `/home/proplet/fixture`. The fixtures directory contains the models.

2. **wasmtime `--dir` flag** in `cli_args`:

   ```json
   "--dir=/home/proplet/fixture::fixture"
   ```

   This exposes the container path to the WASM sandbox as `fixture/`. The WASM code then accesses files via `fixture/model.xml`, `fixture/model.bin`, etc.

**Note:** The path `/home/proplet/fixture` must match your volume mount destination in `compose.yaml`. If you mount to a different path, update the `--dir` flag accordingly.

#### Start Task

```bash
propeller-cli tasks start $TASK_ID
```

### 6. Monitor Execution

**View Logs:**

```bash
# Proplet execution logs
docker compose logs proplet --tail 100

# Expected to see:
# {"level":"INFO","msg":"Executing task","task_id":"..."}
# {"level":"INFO","msg":"Task completed","task_id":"...","exit_code":0}

# Manager logs
docker compose logs manager --tail 50
```

**Retrieve Results:**

```bash
curl -s http://localhost:7070/tasks/$TASK_ID | jq '.results'
```

Sample results:

```bash
Task 841b61
09-5459-4109-8153-b917214c04c5 completed successfully.
Result: Read graph XML, first 50 characters: <?xml version="1.0" ?>
<net name="nobilenet_v2_1.0
Read graph weights, size in bytes: 13956476
Loaded graph into wast-nn with ID: e
Created wasi-nn execution context with ID: 0
Read input tensor, size in bytes: 602112
Executed graph inference
Found results, sorted top 5: [InferenceResult(885, 0.3958259),
InferenceResult(904, 0.36464667),
InferenceResult(84, 0.010480282), InferenceResult(911, 0.008229051), InferenceResult(741,
8.007244824)]
```

## Platform Notes

| Platform              | Library Path Var    | Base64 Flag | OpenVINO Path                     |
| --------------------- | ------------------- | ----------- | --------------------------------- |
| macOS (Intel)         | `DYLD_LIBRARY_PATH` | `-i`        | `/usr/local/lib`                  |
| macOS (Apple Silicon) | `DYLD_LIBRARY_PATH` | `-i`        | `/opt/homebrew/lib`               |
| Linux                 | `LD_LIBRARY_PATH`   | `-w 0`      | `/opt/intel/openvino/runtime/lib` |

### macOS Notes

- Use `DYLD_LIBRARY_PATH` (not `LD_LIBRARY_PATH`)
- Base64 requires `-i` flag; the `-w` flag doesn't exist on macOS
- Docker platform warning about linux/amd64 vs linux/arm64 is normal (uses Rosetta 2)

### Linux Notes

- Use `LD_LIBRARY_PATH` for OpenVINO libraries
- Base64 uses `-w 0` flag for no line wrapping
- Ensure model files have proper permissions: `chmod -R 755 /models`

## Troubleshooting

### wasi-nn module not recognized

**Symptom:** `Error: unknown flag: -S` or `Error: unknown flag: --wasi-modules`

**Solution:**

```bash
# Check wasmtime version
wasmtime --version

# Check available WASI options
wasmtime run -S help | grep nn

# Wasmtime 14.0+: use -S nn
# Wasmtime 0.40-13.x: use --wasi-modules=experimental-wasi-nn

# If not present, rebuild Wasmtime with wasi-nn:
cd /path/to/wasmtime
cargo build --release --features wasi-nn
```

### Model files not found

**Symptom:** `Error: failed to load model: file not found`

**Solution:**

```bash
# Verify model files exist
ls -lh fixture/model.xml fixture/model.bin

# Verify volume mounts in compose.yaml
docker compose config | grep -A 5 volumes

# Check proplet can access files
docker compose exec proplet ls -la /home/proplet/fixture

# Ensure --dir flag is included in cli_args
```

### OpenVINO backend not available

**Symptom:** `Error: Failed while accessing backend`

**Solution:**

```bash
# macOS: Verify OpenVINO installation
ls /opt/homebrew/lib | grep openvino
export DYLD_LIBRARY_PATH=/opt/homebrew/lib

# Linux: Verify OpenVINO installation
ldconfig -p | grep openvino
export LD_LIBRARY_PATH=/opt/intel/openvino/runtime/lib:$LD_LIBRARY_PATH

# Test locally first
wasmtime run -S nn --dir=fixture wasi-nn-example.wasm
```

### Base64 encoding errors

**Symptom:** `Error: invalid base64` or task file is corrupted.

**Solution:**

```bash
# macOS (correct)
WASM_B64=$(base64 -i file.wasm | tr -d '\n')

# Linux (correct)
WASM_B64=$(base64 -w 0 file.wasm)
```

### Volume mount failures

**Symptom:** `Error: not a directory` or files not accessible in container.

**Solution:**

```bash
# Use ABSOLUTE paths in compose.yaml
volumes:
  - /Users/username/fixture:/home/proplet/fixture  # Correct
  - ~/fixture:/home/proplet/fixture                 # May not work (tilde expansion)
  - ./fixture:/home/proplet/fixture                 # Depends on docker compose location

# Verify mounts
docker compose exec proplet ls -la /home/proplet/fixture
```

## Resources

- [Wasmtime wasi-nn Documentation](https://github.com/bytecodealliance/wasmtime/tree/main/crates/wasi-nn)
- [OpenVINO Installation Guide](https://docs.openvino.ai/latest/openvino_docs_install_guides_installing_openvino.html)
- [Propeller Documentation](https://docs.propeller.absmach.eu/)
- [SuperMQ Documentation](https://docs.supermq.absmach.eu/)
