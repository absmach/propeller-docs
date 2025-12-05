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

---

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

---

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

---

## 4. Train and Save Your Model

There are **two supported ways** to save your model:

### **4.1 Recommended: Save using standard `pickle` (fully compatible with m2cgen)**

```python
import pickle

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

---

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

> **Important:**
> The generated file begins with a `func` declaration — it does **not** include `package main`.
> TinyGo requires a valid package header, so you must wrap it.

---

## 6. Produce TinyGo-Compatible Go Package

Because `model2tinygo.go` lacks a `package` declaration, TinyGo will error with:

```bash
expected 'package', found 'func'
```

Fix by wrapping the file:

```bash
python - << 'EOF'
with open("model2tinygo.go") as f:
    src = f.read()

# TinyGo requires a package header.
header = "package main\n\n"
with open("model_gen.go", "w") as f:
    f.write(header + src)

print("Wrote model_gen.go (TinyGo-compatible)")
EOF
```

You now have:

* `model_gen.go` — valid TinyGo Go source containing `func score(...)`
* `model2tinygo.go` — raw output (can be deleted)

Delete the raw file:

```bash
rm model2tinygo.go
```

---

## 7. Create a TinyGo-Compatible WASM Entrypoint (`main.go`)

TinyGo requires a zero-argument `main()`, but Propeller/WAMR/Wazero need a callable exported function.

Use the following:

```go
package main

func predict(x0 int32, x1 int32) int32 {
    in := []float64{
        float64(x0) / 100.0,
        float64(x1) / 100.0,
    }

    y := score(in)

    return int32(y * 100.0)
}

func main() {}
```

The exported function is now:

* Name: **`predict`**
* Args: **two int32 inputs**
* Return: **int32**

This matches WAMR, Wazero, and Propeller’s WASM calling conventions.

---

## 8. Build the WASM File with TinyGo

Compile the entire folder as a Go package:

```bash
tinygo build -o mymodel.wasm -target=wasi .
```

> **Note:**
> Do **not** pass multiple `.go` files as arguments.
> TinyGo requires exactly one package path, so use `.`.

A successful build produces:

```
mymodel.wasm
```

---

## 9. (Optional) Use `just` to Simplify the Workflow

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

---

## 10. Test the WASM Model Locally

Using `wasmer`:

```bash
wasmer run mymodel.wasm --invoke predict 100 200
```

Expected output:

```
800
```

Because:

* Inputs: `100` → 1.00, `200` → 2.00
* Model: `y = 2*1 + 3*2 = 8`
* Output scaled by ×100 → `800`

This confirms the WASM binary runs correctly under WASI.

---

## 11. Running the WASM Model on Propeller

Once you have `mymodel.wasm`, Propeller execution looks like:

1. **Register the WASM file**
   Push it to the Propeller registry as an application.

2. **Create a task**
   Use the exported WASM function `predict`:

   ```bash
   propeller task create \
     --app mymodel \
     --func predict \
     --inputs 100 200 \
     --runtime host
   ```

3. **Start the task**

   ```bash
   propeller task start <task-id>
   ```

4. **Get results**

   ```bash
   propeller task get <task-id>
   ```

Propeller supports:

* Host runtime (`wasmer`)
* Wazero runtime (pure Go)
* Embedded runtime (ESP32 WAMR)

Propeller runtimes support:

* WASI modules
* `i32` arguments
* `i32` return values
* Invocation of custom exported functions (e.g. `predict`)
