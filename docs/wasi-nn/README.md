# wasi-nn Examples

wasi-nn (WebAssembly System Interface for Neural Networks) enables ML inference in WebAssembly modules. It provides a portable API that abstracts the underlying ML framework - your code stays the same whether using OpenVINO, ONNX Runtime, or other backends.

These examples demonstrate running ML inference workloads on [Propeller](https://github.com/absmach/propeller). Propeller orchestrates WebAssembly workloads across cloud and edge devices, making it possible to deploy ML inference to distributed environments.

The wasi-nn examples are sourced from the [wasmtime wasi-nn](https://github.com/bytecodealliance/wasmtime/tree/main/crates/wasi-nn/examples) repository. For detailed instructions on deploying these to Propeller, see [PROPELLER.md](./PROPELLER.md).

## Examples

The following examples are available:

- [x] [Image Classification (MobileNet + OpenVINO)](#image-classification-mobilenet--openvino)
- [x] [ONNX Classification (SqueezeNet + ONNX Runtime)](#onnx-classification-squeezenet--onnx-runtime)
- [ ] PyTorch Classification (Experimental)

## Prerequisites

### Rust and WASM Target

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasip1
```

### Clone Examples

```bash
git clone https://github.com/bytecodealliance/wasmtime.git
cd wasmtime/crates/wasi-nn/examples
```

## Image Classification (MobileNet + OpenVINO)

Uses MobileNet v2 with OpenVINO backend to classify images. MobileNet is a lightweight CNN optimized for edge devices.

| Property | Value                 |
| -------- | --------------------- |
| Model    | MobileNet v2          |
| Backend  | OpenVINO              |
| Input    | 224x224 RGB image     |
| Output   | 1001 ImageNet classes |

### Build WASM Binary

```bash
cd classification-example
cargo build --target wasm32-wasip1 --release
```

Output:

```text
   Compiling wasi-nn-example v0.1.0
    Finished release [optimized] target(s)
```

The WASM binary is at `target/wasm32-wasip1/release/wasi-nn-example.wasm`.

### Prepare Model Files

```bash
mkdir -p fixture && cd fixture
curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.xml
curl -LO https://github.com/intel/openvino-rs/raw/main/crates/openvino/tests/mobilenet/mobilenet.bin
mv mobilenet.xml model.xml
mv mobilenet.bin model.bin
curl -LO https://download.01.org/openvinotoolkit/fixtures/mobilenet/tensor-1x224x224x3-f32.bgr
cd ..
```

### Test Locally (Optional)

If you have wasmtime and OpenVINO installed locally:

```bash
export LD_LIBRARY_PATH=/opt/intel/openvino_2024/runtime/lib/intel64:$LD_LIBRARY_PATH
wasmtime run -S nn --dir=fixture target/wasm32-wasip1/release/wasi-nn-example.wasm
```

Output:

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

Results show ImageNet class IDs with confidence scores. Class 904 = "cardigan" (sweater).

### Deploy to Propeller

See [PROPELLER.md](./PROPELLER.md) for deployment instructions. Key points:

1. Copy `fixture/` to Propeller's mounted directory
2. Create task with `cli_args: ["-S", "nn", "--dir=/home/proplet/fixture::fixture"]`
3. Upload `wasi-nn-example.wasm`
4. Start task

## ONNX Classification (SqueezeNet + ONNX Runtime)

Uses SqueezeNet with ONNX Runtime backend. ONNX provides wider model compatibility across frameworks.

| Property | Value             |
| -------- | ----------------- |
| Model    | SqueezeNet 1.0    |
| Backend  | ONNX Runtime      |
| Input    | 224x224 RGB image |
| Output   | 1000 classes      |

### Build WASM Binary

```bash
cd classification-component-onnx
cargo build --target wasm32-wasip1 --release
```

Output:

```text
   Compiling classification-component-onnx v0.1.0
    Finished release [optimized] target(s)
```

### Prepare Model Files

```bash
mkdir -p fixture && cd fixture
curl -LO https://github.com/onnx/models/raw/main/validated/vision/classification/squeezenet/model/squeezenet1.0-8.onnx
cd ..
```

### Test Locally (Optional)

```bash
wasmtime run -S nn --dir=fixture target/wasm32-wasip1/release/classification-component-onnx.wasm
```

### Deploy to Propeller

See [PROPELLER.md](./PROPELLER.md). Same process as MobileNet:

1. Copy model to Propeller's fixture directory
2. Create task with wasi-nn cli_args
3. Upload WASM binary
4. Start task

## Using Custom Models

### OpenVINO Models

Convert your model to OpenVINO IR format:

```bash
# From TensorFlow
mo --input_model model.pb --output_dir fixture/

# From ONNX
mo --input_model model.onnx --output_dir fixture/
```

### ONNX Models

Export from your framework:

```python
# PyTorch
import torch
torch.onnx.export(model, dummy_input, "fixture/model.onnx")

# TensorFlow/Keras
import tf2onnx
tf2onnx.convert.from_keras(model, output_path="fixture/model.onnx")
```

Update your code to load the new model files and rebuild the WASM binary.

## References

- [wasi-nn Specification](https://github.com/WebAssembly/wasi-nn)
- [Wasmtime wasi-nn Examples](https://github.com/bytecodealliance/wasmtime/tree/main/crates/wasi-nn/examples)
- [OpenVINO](https://docs.openvino.ai/)
- [ONNX Runtime](https://onnxruntime.ai/)
- [Propeller](https://github.com/absmach/propeller)
