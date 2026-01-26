# Encrypted workloads in TEEs

Run WebAssembly workloads inside hardware-protected environments.

---

## What is a TEE

A Trusted Execution Environment (TEE) is a secure area inside a processor that protects code and data from unauthorized access. TEEs use hardware-based security features to create isolated execution environments.

**Common TEE Technologies:**

- **Intel TDX** - Trust Domain Extensions for virtual machines
- **AMD SEV-SNP** - Secure Encrypted Virtualization with Secure Nested Paging
- **Intel SGX** - Software Guard Extensions for application enclaves

TEEs ensure that even system administrators or cloud providers cannot access your workload's data or code while it runs.

---

## How Propeller uses TEEs

Propeller runs WASM workloads inside TEEs by combining encrypted container images with hardware attestation.

**The workflow:**

1. Proplet detects if it runs inside a TEE
2. Manager sends an encrypted workload request
3. Proplet retrieves attestation proof from TEE hardware
4. Key Broker Service validates attestation and releases decryption keys
5. Proplet decrypts the WASM image and executes it

All execution happens inside the protected environment. The WASM code and data remain encrypted until verified by the TEE hardware.

---

## Prerequisites

Install these components before running encrypted workloads:

- **KBS (Key Broker Service)** - Stores encryption keys and validates attestations
- **Attestation Agent** - Communicates with TEE hardware and KBS
- **Proplet with TEE support** - Built with TEE features enabled

---

## Set up the Key Broker Service

The KBS manages encryption keys and validates TEE attestations.

### Start KBS with Docker

```bash
git clone https://github.com/confidential-containers/trustee
cd trustee
docker-compose up -d
```

This starts KBS on `http://localhost:8080`.

### Generate encryption keys

Create a key pair for encrypting WASM images:

```bash
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
```

### Upload private key to KBS

Store the private key in KBS:

```bash
./target/release/kbs-client \
  --url http://localhost:8080 \
  config \
  --auth-private-key kbs/config/private.key \
  set-resource \
  --resource-file private_key.pem \
  --path default/key/my-app
```

The path `default/key/my-app` identifies this key. Use it when creating tasks.

---

## Build Proplet with TEE support

Proplet needs TEE features compiled in.

### Install dependencies

```bash
cd propeller/proplet
rustup target add x86_64-unknown-linux-gnu
```

### Compile with TEE features

```bash
cargo build --release --features "tee,all-attesters"
```

For specific TEE platforms:

```bash
# Intel TDX only
cargo build --release --features "tee,tdx-attester"

# AMD SEV-SNP only
cargo build --release --features "tee,snp-attester"
```

The binary will be in `target/release/proplet`.

---

## Encrypt a WASM image

Container images must be encrypted before deployment.

### Push WASM to local registry

```bash
wasm-to-oci push my-app.wasm localhost/my-app:latest
```

### Encrypt with public key

```bash
skopeo copy \
  --encryption-key jwe:/path/to/public_key.pem \
  oci:localhost/my-app:latest \
  oci:localhost/my-app:encrypted
```

### Push to remote registry

```bash
skopeo copy \
  oci:localhost/my-app:encrypted \
  docker://docker.io/username/my-app:encrypted
```

---

## Configure attestation agent

The attestation agent connects Proplet to the TEE hardware and KBS.

### Create configuration file

Save this as `aa-config.toml`:

```toml
[token_configs.coco_as]
url = "http://localhost:8080"
```

### Start attestation agent

```bash
attestation-agent \
  --aa-config aa-config.toml \
  --attestation_sock /run/attestation-agent.sock
```

The agent listens on port 50010 for keyprovider requests.

---

## Run Proplet in TEE mode

Proplet automatically detects TEEs and enables secure execution.

### Configure environment

```bash
export PROPLET_KBS_URI=http://localhost:8080
export PROPLET_AA_CONFIG_PATH=/path/to/aa-config.toml
export PROPLET_DOMAIN_ID=your-domain-id
export PROPLET_CHANNEL_ID=your-channel-id
export PROPLET_CLIENT_ID=your-client-id
export PROPLET_CLIENT_KEY=your-client-key
```

### Start Proplet

```bash
./target/release/proplet
```

Proplet will log the detected TEE type:

```
INFO TEE detected automatically: TDX (method: device_file)
```

Or if no TEE is present:

```
INFO No TEE detected, running in standard mode
```

---

## Deploy an encrypted workload

Create a task manifest for the encrypted WASM:

```json
{
  "name": "secure-function",
  "image_url": "docker.io/username/my-app:encrypted",
  "encrypted": true,
  "kbs_resource_path": "default/key/my-app",
  "inputs": [10, 20]
}
```

**Important fields:**

- `encrypted: true` - Tells Proplet to use TEE runtime
- `image_url` - Location of encrypted image (required for encrypted workloads)
- `kbs_resource_path` - Path to decryption key in KBS
- Do not include `file` field for encrypted workloads

### Submit the task

```bash
propeller-cli task create \
  --name secure-function \
  --image-url docker.io/username/my-app:encrypted \
  --encrypted \
  --kbs-resource-path default/key/my-app
```

---

## Verify execution

Check task results:

```bash
propeller-cli task get <task-id>
```

The output shows execution status and results. All decryption and execution happened inside the TEE.

---

## Troubleshoot common issues

### "KBS URI must be configured when TEE is detected"

**Cause:** Proplet detected a TEE but `PROPLET_KBS_URI` is not set.

**Fix:** Set the KBS endpoint:

```bash
export PROPLET_KBS_URI=http://localhost:8080
```

### "TEE runtime not available"

**Cause:** Task is marked `encrypted: true` but Proplet lacks TEE support.

**Fix:** Rebuild Proplet with TEE features:

```bash
cargo build --release --features "tee,all-attesters"
```

### "image_url is required for encrypted workloads"

**Cause:** Encrypted task has `file` field or missing `image_url`.

**Fix:** Remove `file` field and set `image_url`:

```json
{
  "image_url": "docker.io/username/app:encrypted",
  "encrypted": true
}
```

### Attestation agent connection failed

**Cause:** Attestation agent is not running or on wrong port.

**Fix:** Start attestation agent and verify port 50010:

```bash
netstat -tlnp | grep 50010
```

---

## Architecture details

### Component interaction

```
┌─────────────┐
│   Manager   │ Sends encrypted task request via MQTT
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Proplet   │ Detects TEE, requests attestation
└──────┬──────┘
       │
       ├─────────────────┐
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────┐
│     TEE     │   │     KBS     │
│  Hardware   │◄──┤  Validates  │
└─────────────┘   │ attestation │
                  └──────┬──────┘
                         │
                         ▼
                  Returns decryption key
```

### Execution flow

1. **Detection** - Proplet checks for TEE device files at startup
2. **Task receipt** - Manager publishes encrypted task request
3. **Image pull** - Proplet downloads encrypted OCI image
4. **Attestation** - Hardware generates proof of TEE environment
5. **Key retrieval** - KBS validates attestation and releases key
6. **Decryption** - Image layers decrypted inside TEE
7. **Execution** - WASM runs in protected environment
8. **Results** - Output published to Manager via MQTT

### Security guarantees

- **Confidentiality** - Code and data encrypted until inside TEE
- **Integrity** - Attestation proves correct TEE configuration
- **Isolation** - Hardware prevents external access to execution
- **Verifiability** - Attestation reports allow remote verification

---

## Next steps

- Learn about [monitoring TEE workloads](#)
- Configure [custom attestation policies](#)
- Deploy [multi-node TEE clusters](#)
