# Encrypted Workload Workflow

Propeller supports AES-256-GCM encryption for Wasm workloads. This ensures that application code remains opaque and secure while in transit over the MQTT broker. Even if an attacker gains access to the message broker, they will only see encrypted ciphertext, not executable logic.

## The Security Model

- **Algorithm:** AES-256-GCM (Galois/Counter Mode)
- **Key Management:** A pre-shared 32-byte hexadecimal key injected into the Manager, Proxy, and Proplet services
- **Trust Boundary:** The MQTT broker is considered untrusted storage. The payload is encrypted before it leaves the Manager or Proxy and decrypted only when it reaches the Proplet's memory

## 1. Setup and Configuration

Before deploying tasks, you must generate a key and configure your infrastructure. By default, Propeller is configured using Docker Compose and environment variables. However, you may also use `config.toml` if you are running services outside of Docker or require explicit configuration files.

### Step 1: Generate a Shared Key

Generate a random 32-byte key using OpenSSL:

```bash
openssl rand -hex 32
```

Save this key. It must be identical across all services.

### Step 2: Configure Services

You must provide the generated key to the Manager, Proplet, and Proxy services.

#### Via Docker Environment Variables (.env) (Default)

```bash
MANAGER_WORKLOAD_KEY=<YOUR_32_BYTE_HEX_KEY>
PROPLET_WORKLOAD_KEY=<YOUR_32_BYTE_HEX_KEY>
PROXY_WORKLOAD_KEY=<YOUR_32_BYTE_HEX_KEY>
```

#### Via config.toml (Alternative)

```toml
[manager]
workload_key = "<YOUR_32_BYTE_HEX_KEY>"

[proplet]
workload_key = "<YOUR_32_BYTE_HEX_KEY>"

[proxy]
workload_key = "<YOUR_32_BYTE_HEX_KEY>"
```

### Configuration Precedence

When both Docker environment variables and `config.toml` are provided, **environment variables take precedence** over values defined in `config.toml`. This allows secure overrides without modifying configuration files.

The resolution order is:

1. Docker environment variables (`.env`)
2. `config.toml`
3. Built-in defaults (if any)

For production deployments, environment variables are strongly recommended to avoid committing secrets to disk.

Perfect, this is the **right structural choice**. Below is a **fully merged, non-repetitive rewrite of Section 2**, where:

* The **user-facing workflows** from your original Section 2
* And the **secure execution mechanics** from Section 5

are combined into **one clean, non-duplicative section**.

You can **replace your entire current Section 2 with this**:

## 2. Operational Workflows and Secure Execution

Propeller supports two encrypted workload delivery methods:

- **Direct Push**
- **Registry Pull**

In both cases, workloads follow the same secure execution pipeline: they are encrypted at the control plane, transmitted over MQTT as ciphertext, decrypted only inside the Proplet’s memory boundary, and executed inside a sandboxed Wasm runtime with zero persistence.

### Scenario A: Direct Push (CLI Upload)

1. **User Action**  
   The user runs:

   ```bash
   propeller-cli tasks create ...
   ```

   and uploads a local Wasm file.

2. **Manager Ingestion**

   The Manager receives the plaintext Wasm file over HTTPS (TLS-secured).

3. **Control Plane Encryption**

   - The workload bytes are encrypted using AES-256-GCM
   - A unique nonce is generated per encryption operation
   - An authentication tag is produced to guarantee integrity
   - Only encrypted ciphertext is published to MQTT

4. **Encrypted Transport Over MQTT**

   - The MQTT broker only ever sees encrypted data
   - The broker is treated as an untrusted transport layer

5. **Proplet Decryption and Execution**

   - The encrypted payload is decrypted **directly in memory**
   - The authentication tag is verified before execution
   - If verification fails, execution is aborted immediately
   - The plaintext Wasm binary is passed directly to the runtime
   0 Supported runtimes include:

     - Wazero
     - WAMR
   - Execution occurs inside a fully sandboxed Wasm environment

6. **Execution Teardown**

   - The runtime instance is terminated after completion
   - Decrypted workload data is released from memory
   - No executable artifacts are persisted to disk
   - Only execution metadata is reported back to the Manager

### Scenario B: OCI Registry Pull (Proxy)

1. **User Action**
   The user runs:

   ```bash
   propeller-cli tasks create ... --image <oci-url>
   ```

2. **Manager Dispatch**

   The Manager sends a start command to the Proplet containing the OCI image reference.

3. **Proplet Request**

   The Proplet requests the workload from the Proxy service over MQTT.

4. **Proxy Fetch and Encryption**

   - The Proxy pulls the image from the OCI registry over HTTPS
   - The Wasm binary is extracted and split into chunks
   - Each chunk is encrypted using AES-256-GCM
   - Encrypted chunks are published to MQTT

5. **Secure Reassembly and Decryption**

   - The Proplet receives all encrypted chunks
   - The full binary is reassembled
   - Decryption occurs entirely in memory
   - Authentication is verified before execution

6. **Sandboxed Wasm Execution and Teardown**

   - The decrypted workload is executed inside the Wasm runtime
   - The runtime is terminated after completion
   - Decrypted artifacts are released from memory
   - Only execution metadata is persisted

This unified workflow enforces a **zero-persistence execution model** in which:

- Plaintext workloads never transit MQTT
- Decrypted workloads never touch disk
- Only trusted runtime memory contains executable code
- All inter-service transport remains encrypted end-to-end

## 3. How to Verify Encryption

To verify that encryption is active and that the broker is not seeing plaintext data, inspect the Docker logs.

### Step 1: Deploy a Task

```bash
./propeller-cli tasks create my-secure-task --file ./examples/hello-world/build/hello.wasm
./propeller-cli tasks start <TASK_ID>
```

### Step 2: Check Proplet Logs

```bash
docker logs propeller-proplet
```

#### Successful Output

```text
INFO Received start command app_name=hello.wasm
INFO Finished running app id=<TASK_ID>
```

#### Failed Output (Key Mismatch)

```text
ERROR Failed to decrypt workload error="cipher: message authentication failed"
```
