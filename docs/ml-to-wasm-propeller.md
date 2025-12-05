# Converting Python ML Models to WASM for Propeller using `model2wasm`

This guide explains how to convert a trained Python machine-learning model into a **WASM** module using the [`model2wasm`](https://github.com/FriedShrimpBBQ/model2wasm) toolchain, so it can be deployed on a Propeller runtime that supports **WASI**.

## 1. Overview

The `model2wasm` pipeline does:

1. Load a saved Python model (`.pkl`)
2. Use **m2cgen** to generate equivalent **Go** code
3. Adapt the Go code for **TinyGo**
4. Compile to a **WASI-compatible `.wasm`** file
5. Run the WASM model locally or inside Propeller runtimes (host, wazero, embedded)

Propeller then only needs to host and call the generated WASM module.

## 2. Prerequisites

You’ll need:

* **Python 3** (venv recommended)
* **m2cgen** + your ML library (e.g. `scikit-learn`)
* **Go**
* **TinyGo**
* Optional helpers:

  * `just` — to automate the workflow
  * `wasmer` — for local WASM testing

Clone the repository:

```bash
git clone https://github.com/FriedShrimpBBQ/model2wasm.git
cd model2wasm
```

## 3. Set up the Python environment

Create and activate a virtual environment:

```bash
python -m venv venv
source venv/bin/activate   # Linux/macOS
# OR
venv\Scripts\activate      # Windows
```

Install dependencies:

```bash
pip install m2cgen scikit-learn
```

> Install other ML libraries if your model depends on them.

## 4. Train and Save Your Model

There are **two supported ways** to save your model:

### **4.1 Recommended: Save using standard `pickle` (fully compatible with m2cgen)**

```python
import pickle

# model = ...  # train your model

with open("mymodel.pkl", "wb") as f:
    pickle.dump(model, f)
```

This produces a pickle file that **m2cgen can load directly**.

### **4.2 Saving with `joblib` (requires an extra conversion step)**

You *can* save using joblib:

```python
import joblib
joblib.dump(model, "mymodel.pkl")
```

However, **m2cgen cannot read joblib files**, so you must convert them:

```bash
python - << 'EOF'
import joblib, pickle

model = joblib.load("mymodel.pkl")
with open("mymodel_m2cgen.pkl", "wb") as f:
    pickle.dump(model, f)

print("Converted joblib model to m2cgen-compatible pickle")
EOF
```

Now use **`mymodel_m2cgen.pkl`** with `m2cgen`.

### 4.3 Demo model

You can also generate a demo model:

```bash
python demo/generate_model_example.py --filename mymodel
```

## 5. Generate Go Code from the Model

If using pickle:

```bash
m2cgen mymodel.pkl --language go > model2tinygo.go
```

If using converted joblib:

```bash
m2cgen mymodel_m2cgen.pkl --language go > model2tinygo.go
```

This file contains the model’s prediction logic translated into Go.

## 6. Produce TinyGo-Compatible Main File

Generate `main.go`:

```bash
go run model2tinygo.go > main.go
```

You now have:

* `model2tinygo.go` — generated model logic
* `main.go` — Go entrypoint compatible with TinyGo/WASI

## 7. Build the WASM File with TinyGo

Compile to WASI:

```bash
tinygo build -o mymodel.wasm -target=wasi -wasm-abi=generic main.go
```

Now you have a fully portable WASM ML model.

## 8. (Optional) Use `just` to Simplify the Workflow

List available tasks:

```bash
just -l
```

Example usage:

```bash
just build-wasm mymodel.pkl mymodel.go mymodel.wasm
```

Or on Windows:

```bash
just --shell powershell.exe --shell-arg -c build-wasm mymodel.pkl mymodel.go mymodel.wasm
```

The `just` recipe handles:

1. m2cgen → Go
2. Go → TinyGo main
3. TinyGo → WASM

## 9. Test the WASM Model Locally

Use `wasmer`:

```bash
wasmer mymodel.wasm -- 1 2 -2 -1
```

Example output:

```shell
199
```

This verifies the WASM binary runs under a WASI environment.

## 10. Running the WASM Model on Propeller

Once you have `mymodel.wasm`, Propeller execution looks like:

1. **Register the WASM file**
   Place it in your model registry or deploy it as an app.

2. **Create a task**
   Pass your model inputs as arguments to the WASM function.

3. **Start the task**
   Propeller executes the model in one of its runtimes:

   * Host (`wasmer`)
   * Wazero (pure Go)
   * Embedded (ESP32 WAMR)

4. **Read the results**
   Returned values are provided via stdout (host), results arrays (wazero), or MQTT (embedded).

Propeller runtimes support:

* WASI modules
* i32/u32 arguments
* Reading one or more return values
