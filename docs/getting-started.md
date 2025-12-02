# Getting Started

Before proceeding, install the following prerequisites:

* [A Go compiler (Go 1.24 or later)](https://go.dev/doc/install)
* [Make](https://www.gnu.org/software/make/manual/make.html)
* [Docker](https://docs.docker.com/)
* [Wasmtime](https://wasmtime.dev/)
* [TinyGo](https://tinygo.org/getting-started/install/)
* [Mosquitto Tools](https://mosquitto.org/)
* [rustup](https://rustup.rs/)

> **Note:** `rustup` will install the Rust toolchain and `cargo`. You will also use it to add WebAssembly targets.

---

## Clone the repository

Clone the repository:

```bash
git clone https://github.com/absmach/propeller.git
cd propeller
```

---

## Build and Install the Artifacts

This step compiles all Propeller components (manager, proplet, CLI, proxy, and example WASM modules).
Run the following:

```bash
make all -j $(nproc)
make install
```

### If `make install` fails

You likely don’t have your Go binary path (`$GOBIN`) configured.
Set it up like this:

```bash
export GOBIN=$HOME/go/bin
export PATH=$PATH:$GOBIN
```

Run `make install` again afterward.

---

### What the build process does

During the build, you will see output similar to:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... -o build/manager cmd/manager/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... -o build/proplet cmd/proplet/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... -o build/cli cmd/cli/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ... -o build/proxy cmd/proxy/main.go

GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/addition.wasm     -target wasip1 examples/addition/addition.go
GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/compute.wasm      -target wasip1 examples/compute/compute.go
GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/hello-world.wasm  -target wasip1 examples/hello-world/hello-world.go
```

This means:

* All Go binaries were built and placed into `build/`
* All example WASM modules were built using TinyGo into `build/`

---

### Installing the artifacts

`make install` copies the compiled binaries into your `$GOBIN` directory so you can run them directly from your terminal:

```bash
cp build/cli      $GOBIN/propeller-cli
cp build/manager  $GOBIN/propeller-manager
cp build/proplet  $GOBIN/propeller-proplet
cp build/proxy    $GOBIN/propeller-proxy
```

Once installed, you can run the commands simply as:

```bash
propeller-manager
propeller-proplet
propeller-cli
propeller-proxy
```

---

## Working with the Rust WASI HTTP Example

Propeller includes an example Rust WebAssembly HTTP component: `sample-wasi-http-rust`. Running the Rust WASI example validates your Rust/WASM setup and shows how a single WASI HTTP component works before integrating it with Propeller. This section shows you how to fetch it, build it, run it, and test it.

You can also refer to the original project’s instructions here:
[https://github.com/bytecodealliance/sample-wasi-http-rust#sample-wasihttp-in-rust](https://github.com/bytecodealliance/sample-wasi-http-rust#sample-wasihttp-in-rust)

### 1. Initialize the Git submodules

From the root of the `propeller` repository:

```bash
git submodule update --init
cd examples/sample-wasi-http-rust
```

This pulls in the `sample-wasi-http-rust` example code.

### 2. Install the required Rust target

The example builds to a WebAssembly target. If you see errors about missing `wasm32-wasip2` or `wasm32-wasip1`, you need to add the target.

A safe default is to add the Preview 2 target:

```bash
rustup target add wasm32-wasip2
```

> If this command fails, update Rust first:
>
> ```bash
> rustup update
> rustup target add wasm32-wasip2
> ```

### 3. Build the Rust example

Build the example for the WebAssembly target:

```bash
cargo build --target wasm32-wasip2
```

If the build completes successfully, you will see a message similar to:

```bash
Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs
```

At this point, you have a compiled WASI HTTP component.

### 4. Install `cargo-component` (once)

`cargo-component` makes it easy to work with Wasm components and run them with Wasmtime.

Install it using `cargo`:

```bash
cargo install cargo-component
```

You only need to do this once on your machine.

### 5. Serve the Rust component locally

From inside `examples/sample-wasi-http-rust`:

```bash
cargo component serve
```

On first run, this may automatically install the `wasm32-wasip1` component standard library and then print something like:

```bash
Creating component target/wasm32-wasip1/debug/sample_wasi_http_rust.wasm
Running `target/wasm32-wasip1/debug/sample_wasi_http_rust.wasm`
Serving HTTP on http://0.0.0.0:8080/
```

This means your WASI HTTP component is now running as an HTTP server on port `8080`.

Leave this terminal open while the server is running.

### 6. Test the Rust HTTP endpoints

Open a **new terminal** and run the following commands to test the different routes:

#### Hello world route

```bash
curl -v http://127.0.0.1:8080/
```

You should see a `200 OK` response with a body similar to:

```text
Hello, wasi:http/proxy world!
```

#### Wait route

```bash
curl -v http://127.0.0.1:8080/wait
```

This route sleeps briefly before responding, and you should see:

```text
slept for 1001 millis
```

#### Echo body route

```bash
curl -v http://127.0.0.1:8080/echo -d 'hello from John Doe'
```

The response will echo the request body back:

```text
hello from John Doe
```

#### Echo headers route

```bash
curl -v http://127.0.0.1:8080/echo-headers -H 'X-Test: 123' -H 'X-Foo: bar'
```

You will see the headers reflected in the response:

```text
x-foo: bar
user-agent: curl/...
accept: */*
x-test: 123
```

#### Echo trailers route

```bash
curl -v http://127.0.0.1:8080/echo-trailers
```

This demonstrates handling of HTTP trailers over WASI HTTP.

> **When you are done:**
> Go back to the terminal running `cargo component serve` and press `Ctrl+C` to stop the server.

---

## Run SuperMQ and Propeller

Propeller needs to talk to a running SuperMQ instance.
To get everything working, you’ll always do these three high-level steps:

1. **Start SuperMQ** – so the CLI has something to talk to.
2. **Provision SuperMQ** with `propeller-cli provision` – this creates the domain, clients, channels, and writes a `config.toml` file with all the IDs and keys.
3. **Start (or restart) the Propeller services** – so `propeller-manager`, `propeller-proplet`, and `propeller-proxy` can read `config.toml` and connect correctly.

You can run the services in two ways:

* **Option 1 (recommended):** everything via **Docker**
* **Option 2:** run the **Propeller binaries directly** on your machine

Pick one option and follow it from start to finish.

---

## Option 1: Run everything with Docker (recommended)

In this mode, Docker runs:

* SuperMQ core services (auth, users, clients, domains, channels, adapters, etc.)
* Propeller services: **manager**, **proplet**, and **proxy**

> When you run `make start-supermq`, you are starting **both** SuperMQ and the Propeller services defined in `docker/compose.yaml`.

### 1. Start the SuperMQ Docker stack (first time)

From the root of the `propeller` repo:

```bash
cd propeller
make start-supermq
```

This runs:

```bash
docker compose -f docker/compose.yaml --env-file docker/.env up -d
```

At this point:

* SuperMQ is up and reachable.
* Propeller containers (manager, proplet, proxy) will **fail to start correctly** on the first run.
  That’s OK - they don’t have credentials yet because `config.toml` doesn’t exist.

We only need SuperMQ up now so we can **provision** it.

---

### 2. Provision SuperMQ with `propeller-cli`

Now we create everything Propeller needs **inside** SuperMQ and generate the config file.

Run:

```bash
propeller-cli provision
```

This command will:

* Log you into SuperMQ (you must have a SuperMQ user already created; if not, create one using the [supermq-cli](https://docs.supermq.abstractmachines.fr/cli#create-user), `curl`, or the web UI).
* Create a **domain**
* Log your user into that domain
* Create a **manager client**
* Create a **proplet client**
* Create a **manager channel**
* Connect the manager client to the manager channel
* Connect the proplet client to the manager channel
* Write all of these IDs and keys into a **`config.toml`** file in the current directory

The process will look something like this:

[![asciicast](https://asciinema.org/a/8oYuONLQkvuJ3jdjYdVH97qxH.svg)](https://asciinema.org/a/8oYuONLQkvuJ3jdjYdVH97qxH)

If it succeeds, you’ll see:

```bash
Successfully created config.toml file
```

Your `config.toml` will look like:

```toml
# SuperMQ Configuration

[manager]
domain_id = "182c0907-002c-4bfd-8bf3-e4f40c58dde6"
client_id = "f2fe9a33-144a-4346-a5d6-38e2eb07815e"
client_key = "ef7da52b-c01f-4b62-9502-6723d639405b"
channel_id = "8c6e1e6c-fc89-43b4-b00b-884a690c7419"

[proplet]
domain_id = "182c0907-002c-4bfd-8bf3-e4f40c58dde6"
client_id = "fa407362-9c5f-41b8-9a09-9d0c0b039287"
client_key = "991c4d03-2f2c-4ba5-97a6-45bead85457e"
channel_id = "8c6e1e6c-fc89-43b4-b00b-884a690c7419"

[proxy]
domain_id = "182c0907-002c-4bfd-8bf3-e4f40c58dde6"
client_id = "fa407362-9c5f-41b8-9a09-9d0c0b039287"
client_key = "991c4d03-2f2c-4ba5-97a6-45bead85457e"
channel_id = "8c6e1e6c-fc89-43b4-b00b-884a690c7419"
```

> **Why we did this:**
> Propeller needs these IDs and keys to authenticate to SuperMQ.
> They don’t exist until you run `propeller-cli provision`, so we couldn’t start Propeller “fully” before this step.

---

### 3. Mount `config.toml` into the Docker services

For the Docker containers to see `config.toml`, we need to mount it.

If the compose file uses a path under `docker/`, copy the file:

```bash
cp config.toml docker/config.toml
```

Then, in `docker/compose.yaml`, make sure the Propeller services (manager, proplet, proxy) have a volume like this:

```yaml
volumes:
  - ./config.toml:/config.toml
# or, if you copied it into docker/:
#  - ./config.toml:/config.toml
```

Uncomment or add these lines as needed.

---

### 4. Restart the Docker stack so Propeller reads `config.toml`

Now that:

* SuperMQ is provisioned, and
* `config.toml` exists and is mounted into the containers,

we restart the stack:

```bash
make stop-supermq
make start-supermq
```

On this second start:

* `propeller-manager`, `propeller-proplet`, and `propeller-proxy` start up,
* They see `/config.toml` inside the container,
* They read the `[manager]`, `[proplet]`, and `[proxy]` sections,
* They connect to SuperMQ using the correct domain, client IDs, client keys, and channel IDs.

At this point, your system is up and ready to use.

---

## Option 2: Run Propeller binaries directly (without Docker)

In this mode:

* SuperMQ may still run in Docker (via `make start-supermq`), **but**
* You run the Propeller processes (`propeller-manager`, `propeller-proplet`, `propeller-proxy`) directly on your host.

The provisioning step is **the same** as in Option 1:

1. Start SuperMQ (Docker or however you like)
2. Run `propeller-cli provision` to generate `config.toml`

Make sure `config.toml` is in the directory where you will start the binaries, or set env vars to point them at the correct file.

### 1. Start the manager

```bash
propeller-manager
```

If everything is configured correctly, you’ll see logs similar to:

```json
{"time":"2025-06-12T14:13:56.74162598+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:13:56.793894993+03:00","level":"INFO","msg":"Subscribe to MQTT topic completed successfully","duration":"52.272009ms"}
{"time":"2025-06-12T14:13:56.794210043+03:00","level":"INFO","msg":"manager service http server listening at localhost:7070 without TLS"}
```

The manager exposes an HTTP API on `localhost:7070`.

---

### 2. Start the proplet

In another terminal:

```bash
propeller-proplet
```

Example logs:

```json
{"time":"2025-06-12T14:14:44.362072799+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:14:44.398147897+03:00","level":"INFO","msg":"Proplet service is running."}
```

A proplet will automatically register itself with the manager.

---

### 3. Start the proxy

The proxy needs to know which OCI registry to pull WebAssembly images from.
Set a few environment variables, then start it:

```bash
export PROXY_REGISTRY_URL="docker.io"
export PROXY_AUTHENTICATE="TRUE"
export PROXY_REGISTRY_USERNAME=""   # set if your registry requires auth
export PROXY_REGISTRY_PASSWORD=""   # set if your registry requires auth

propeller-proxy
```

Example logs:

```json
{"time":"2025-06-12T14:15:18.438848211+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:15:18.438823293+03:00","level":"INFO","msg":"successfully initialized MQTT and HTTP config"}
{"time":"2025-06-12T14:15:18.438886395+03:00","level":"INFO","msg":"starting proxy service"}
{"time":"2025-06-12T14:15:18.452592155+03:00","level":"INFO","msg":"successfully subscribed to topic"}
```

---

## Postman Collection

This is a [collection](./api/postman_collection.json) of the API calls that can be used to interact with the Propeller system.

---

## API

### List Proplets

```bash
curl -X GET "http://localhost:7070/proplets"
```

This will output a response like the following:

```json
{
  "offset": 0,
  "limit": 100,
  "total": 1,
  "proplets": [
    {
      "id": "fa407362-9c5f-41b8-9a09-9d0c0b039287",
      "name": "Wojahn-Omohundro",
      "task_count": 1,
      "alive": true,
      "alive_history": [
        "2025-06-12T14:22:04.379038459+03:00",
        "2025-06-12T14:22:14.378443596+03:00",
        "2025-06-12T14:22:24.379305586+03:00",
        "2025-06-12T14:22:34.378765631+03:00",
        "2025-06-12T14:22:44.381274342+03:00",
        "2025-06-12T14:22:54.378152057+03:00",
        "2025-06-12T14:23:04.380171407+03:00",
        "2025-06-12T14:23:14.379503767+03:00",
        "2025-06-12T14:23:24.379971214+03:00",
        "2025-06-12T14:23:34.378886406+03:00"
      ]
    }
  ]
}
```

---

### Create task

```bash
curl -X POST "http://localhost:7070/tasks" \
-H "Content-Type: application/json" \
-d '{"name": "add", "inputs": [10, 20]}'
```

This will output a response like the following:

```json
{
  "id": "e9858e56-a1dd-4e5a-9288-130f7be783ed",
  "name": "add",
  "state": 0,
  "cli_args": null,
  "inputs": [10, 20],
  "start_time": "0001-01-01T00:00:00Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "created_at": "2025-06-12T14:25:22.407167091+03:00",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

You can use the CLI to create a task as follows:

```bash
# propeller-cli tasks create <name>
propeller-cli tasks create demo
```

This will output a response like the following:

```json
{
  "created_at": "2025-09-16T10:25:31.491528704Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "id": "2ccb6b7c-3ce8-4c27-be19-01172954d593",
  "name": "demo",
  "start_time": "0001-01-01T00:00:00Z",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

---

### Get a task

```bash
curl -X GET "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed"
```

This will output a response like the following:

```json
{
  "id": "e9858e56-a1dd-4e5a-9288-130f7be783ed",
  "name": "add",
  "state": 0,
  "cli_args": null,
  "inputs": [10, 20],
  "start_time": "0001-01-01T00:00:00Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "created_at": "2025-06-12T14:25:22.407167091+03:00",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

You can use the CLI to get a task as follows:

```bash
# propeller-cli tasks view <id>
propeller-cli tasks view 2ccb6b7c-3ce8-4c27-be19-01172954d593
```

This will output a response like the following:

```json
{
  "created_at": "2025-09-16T10:25:31.491528704Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "id": "2ccb6b7c-3ce8-4c27-be19-01172954d593",
  "name": "demo",
  "start_time": "0001-01-01T00:00:00Z",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

---

### Upload Wasm File

```bash
curl -X PUT "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/upload" \
-F 'file=@<propeller_path>/build/addition.wasm'
```

---

### Update task with base64 encoded Wasm file

```bash
curl --location --request PUT 'http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed' \
--header 'Content-Type: application/json' \
--data '{
    "file": "AGFzbQEAAAABBwFgAn9/AX8DAgEABwgBBG1haW4AAAoJAQcAIAAgAWoL"
}'
```

```bash
propeller-cli tasks update e9858e56-a1dd-4e5a-9288-130f7be783ed '{"file": "AGFzbQEAAAABBwFgAn9/AX8DAgEABwgBBG1haW4AAAoJAQcAIAAgAWoL"}'
```

---

### Start a task

```bash
curl -X POST "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/start"
```

You can use the CLI to start a task as follows:

```bash
# propeller-cli tasks start <id>
propeller-cli tasks start 2ccb6b7c-3ce8-4c27-be19-01172954d593
```

This will output a response like the following:

```bash
ok
```

---

### Stop a task

```bash
curl -X POST "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/stop"
```

---

### Creating Tasks from OCI Registry Images

For WebAssembly modules stored in an OCI registry, you can specify the image URL during task creation. The proxy will automatically retrieve the WASM file from the registry when the task starts, eliminating the need for manual file uploads.

```bash
curl -X POST "http://localhost:7070/tasks" \
-H "Content-Type: application/json" \
-d '{"name": "add", "inputs": [10, 20], "image_url": "docker.io/mrstevenyaga/add.wasm"}'
```

The proxy will handle pulling the image from the specified OCI registry during task execution, streamlining the deployment process.
