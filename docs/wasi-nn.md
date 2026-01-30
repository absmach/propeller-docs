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

Install Rust and add WebAssembly support to compile the example code:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasip1
```

Get the example code from the wasmtime repository:
In a separate folder from the propeller folder, clone the wasmtime repo.

```bash
git clone https://github.com/bytecodealliance/wasmtime.git
cd wasmtime/crates/wasi-nn/examples/classification-example
```

Install wasmtime locally for testing. This allows you to verify the WASM binary and model files work correctly before deploying to Propeller:

```bash
# Option 1: Check existing installation
wasmtime run -S help | grep nn
# Should show: -S nn[=y|n] -- Enable support for WASI neural network imports

# Option 2: Build from source
cd wasmtime
cargo build --release --features wasi-nn
```

## Execution Steps

### Local Development Environment

#### Build the WASM Binary

Compile the example to WebAssembly:

```bash
cd wasmtime/crates/wasi-nn/examples/classification-example
cargo build --target wasm32-wasip1 --release
```

The .wasm output will bw stored at `target/wasm32-wasip1/release/wasi-nn-example.wasm`

#### Prepare Model Files

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

#### Test Locally

Run the example locally to verify everything works before deploying to Propeller:

```bash
export LD_LIBRARY_PATH=/opt/intel/openvino/runtime/lib:$LD_LIBRARY_PATH  # Linux
# export DYLD_LIBRARY_PATH=/opt/homebrew/lib  # macOS Apple Silicon
# export DYLD_LIBRARY_PATH=/usr/local/lib  # macOS Intel


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

### Propeller Worker Environment

The Propeller Docker image comes pre-built with:

- wasmtime v39.0.1 with wasi-nn support at `/usr/local/bin/wasmtime`
- OpenVINO 2025.4.0 libraries at `/opt/intel/openvino_2025`
- All necessary environment variables configured

You only need to configure the proplet to use the external runtime and mount your model files.

#### 1. Configure Propeller

Navigate to the root of the propeller directory. Create MQTT credentials for Propeller components to communicate. Make sure SuperMQ is running before provisioning Propeller ([more details here](https://docs.propeller.absmach.eu/getting-started/#run-supermq-and-propeller)).

```bash
cd /path/to/propeller
propeller-cli provision
```

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

**Understanding directory mapping:**

For your WASM module to access model files, two mappings are required:

| Layer               | Mapping                                           | Purpose                                                            |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Host → Container | `./fixture:/home/proplet/fixture` (volume mount)  | Makes your local model files accessible inside the container       |
| 2. Container → WASM | `--dir=/home/proplet/fixture::fixture` (cli_args) | Makes container files accessible to the WASM sandbox as `fixture/` |

The volume mount above handles layer 1. Layer 2 is configured when submitting the task (see cli_args below).

Start Propeller services:

```bash
docker compose up -d
```

### 2. Create Task

There are multiple ways someone can create a task to assign to a proplet in propeller. You can submit it using our APIs or you can use our propeller-cli to do the same. However, at any given time, `cli_args` needs to be passed with appropriate values to allow wasi-nn functionality.

**Understanding cli_args:**

| Flag                                   | Purpose                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `-S nn`                                | Enables wasi-nn support in wasmtime                                       |
| `--dir=/home/proplet/fixture::fixture` | Maps container path `/home/proplet/fixture` to WASM sandbox as `fixture/` |

---

The `--dir` flag completes the second layer of directory mapping. Your WASM code can now access files as `fixture/model.xml`, `fixture/model.bin`, etc.

#### a. Create task using the API(cli_args must be set at creation time)

```bash
curl -X POST http://localhost:7070/tasks \
 -H "Content-Type: application/json" \
 -d '{
"name": "wasi-nn-demo",
"cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]
}'

```

Sample response:

```json
{
  "id": "3fc0a69a-6c1c-4944-bd71-1117e9ddcf31",
  "name": "wasi-nn-demo2",
  "state": 0,
  "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"],
  "daemon": false,
  "encrypted": false,
  "start_time": "0001-01-01T00:00:00Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "created_at": "2026-01-30T14:30:35.983946888Z",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

Save the task ID from the response:

```bash
TASK_ID="3fc0a69a-6c1c-4944-bd71-1117e9ddcf31"
```

Upload the WASM binary using the upload endpoint. Make sure the path specified in file matches where the .wasm target is stored:

```bash
# Upload as multipart form data
curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \
  -F "file=@target/wasm32-wasip1/release/wasi-nn-example.wasm"

`Sample Output:
{"id":"3fc0a69a-6c1c-4944-bd71-1117e9ddcf31","name":"wasi-nn-demo2","state":0,"file":"<Encoded Wasm B64>","cli_args":["-S","nn","--dir=/home/proplet/fixture::fixture"],"daemon":false,"encrypted":false,"start_time":"0001-01-01T00:00:00Z","finish_time":"0001-01-01T00:00:00Z","created_at":"2026-01-30T14:30:35.983946888Z","updated_at":"2026-01-30T14:44:59.866850384Z"}
`
```

Start the task:

```bash
curl -X POST "http://localhost:7070/tasks/${TASK_ID}/start"
`Sample Output:
{"started":true}`
```

#### b. Create task with Propeller CLI (cli_args must be passed)

```bash
# Create with cli_args using CLI
propeller-cli tasks create wasi-nn-demo --cli-args="-S,nn,--dir=/home/proplet/fixture::fixture"

#Sample Output
#{
# "cli_args": [
#    "-S",
#    "--dir=/home/proplet/fixture::fixture"
#  ],
#  "created_at": "2026-01-30T14:51:24.25935184Z",
#  "finish_time": "0001-01-01T00:00:00Z",
#  "id": "d03fd7e6-fb24-4b76-aec7-3dd245b47ed9",
#  "name": "wasi-nn-demo",
#  "start_time": "0001-01-01T00:00:00Z",
#  "updated_at": "0001-01-01T00:00:00Z"
#}

# Get task ID from output
TASK_ID="<id-from-output>"

# Upload WASM file
curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \
  -F "file=@target/wasm32-wasip1/release/wasi-nn-example.wasm"

# Start
propeller-cli tasks start $TASK_ID
```

> **Important:** `cli_args` must be set when creating the task. They cannot be changed via the update endpoint.

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
"Read graph XML, first 50 characters: <?xml version=\"1.0\" ?>\n<net name=\"mobilenet_v2_1.0\nRead graph weights, size in bytes: 13956476\nLoaded graph into wasi-nn with ID: 0\nCreated wasi-nn execution context with ID: 0\nRead input tensor, size in bytes: 602112\nExecuted graph inference\nFound results, sorted top 5: [InferenceResult(885, 0.3958259), InferenceResult(904, 0.36464667), InferenceResult(84, 0.010480282), InferenceResult(911, 0.008229051), InferenceResult(741, 0.007244824)]\n"
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

### Failed to spawn host runtime process

**Symptom:** ERROR Task 9a4bd523-a65b-499b-8a55-e756752db9db failed: Failed to spawn host runtime process: . Command: []

**Solution:**
The error shows the external runtime path is empty. The PROPLET_EXTERNAL_WASM_RUNTIME needs to be set to wasmtime for wasi-nn tasks. Please set this variable in the .env file. Then recreate the proplet to pick up the environment variable.

```bash
# External runtime required for wasi-nn tasks
PROPLET_EXTERNAL_WASM_RUNTIME="wasmtime"

#Recreate proplet after modifying env file
docker compose -f docker/compose.yaml --env-file docker/.env up -d --force-recreate proplet
```

### Error: failed to run main module `/tmp/proplet\_<proplet_guid>

**Symptom:** 1, stderr: Error: failed to run main module `/tmp/proplet_9a4bd523-a65b-499b-8a55-e756752db9db.wasm`

```bash
Caused by:

0: failed to instantiate "/tmp/proplet_9a4bd523-a65b-499b-8a55-e756752db9db.wasm"

1: unknown import: `wasi_ephemeral_nn::get_output` has not been defined
```

The error shows wasmtime is running but wasi-nn is not enabled. You need to include -S nn in the task's cli_args.

**Solution**
The task should be created with:

```bash
./build/cli tasks create wasi-nn-demo --cli-args="-S,nn,--dir=/home/proplet/fixture::fixture"
Or via curl:
curl -X POST http://localhost:7070/tasks \  -H "Content-Type: application/json" \  -d '{    "name": "wasi-nn-demo",    "cli_args": ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]  }'
```

Then upload the WASM file and start the task.

```bash
# Upload WASM (use the new task ID from above)
TASK_ID="<new-task-id>"curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \    -F "file=@/target/wasm32-wasip1/release/wasi-nn-example.wasm"
# Start task
./build/cli tasks start $TASK_ID
```

The -S nn flag is what tells wasmtime to enable wasi-nn support.

### Error handling message: either file or image_url must be provided

**Symptom:** ERROR Error handling message: either file or image_url must be provided

**Solution:**
The task was created with cli_args. Now you need to upload the WASM file before starting. Make sure the path in file exists.

```bash
# Upload WASM (use the new task ID from above)
TASK_ID="<new-task-id>"curl -X PUT "http://localhost:7070/tasks/${TASK_ID}/upload" \    -F "file=@/target/wasm32-wasip1/release/wasi-nn-example.wasm"
# Start task
./build/cli tasks start $TASK_ID
```

## Resources

- [Wasmtime wasi-nn Documentation](https://github.com/bytecodealliance/wasmtime/tree/main/crates/wasi-nn)
- [OpenVINO Installation Guide](https://docs.openvino.ai/latest/openvino_docs_install_guides_installing_openvino.html)
- [Propeller Documentation](https://docs.propeller.absmach.eu/)
- [SuperMQ Documentation](https://docs.supermq.absmach.eu/)
