# Getting Started

Before proceeding, install the following prerequisites:

- [A Go compiler (Go 1.24 or later)](https://go.dev/doc/install)
- [Make](https://www.gnu.org/software/make/manual/make.html)
- [Docker](https://docs.docker.com/)
- [Wasmtime](https://wasmtime.dev/)
- [TinyGo](https://tinygo.org/getting-started/install/)
- [Mosquitto Tools](https://mosquitto.org/)
- [rustup](https://rustup.rs/) - This is needed to build the `sample-wasi-http-rust` example.

## Clone the repository

Clone the repository

```bash
git clone https://github.com/absmach/propeller.git
cd propeller
```

## Build and Install the artifacts

Build and install the artifacts

```bash
make all -j $(nproc)
make install
```

If you are having issues with the `make install` command, you will need to setup `$GOBIN` and add `$GOBIN` to your `$PATH` environment variable.

```bash
export GOBIN=$HOME/go/bin
export PATH=$PATH:$GOBIN
```

The output of the build command will be something like:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X 'github.com/absmach/supermq.BuildTime=2025-09-16T08:51:10Z' -X 'github.com/absmach/supermq.Version=v0.3.0' -X 'github.com/absmach/supermq.Commit=1e4e360c2182aa9bd6febb39756e3398fa4139ca'" -o build/manager cmd/manager/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X 'github.com/absmach/supermq.BuildTime=2025-09-16T08:51:10Z' -X 'github.com/absmach/supermq.Version=v0.3.0' -X 'github.com/absmach/supermq.Commit=1e4e360c2182aa9bd6febb39756e3398fa4139ca'" -o build/proplet cmd/proplet/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X 'github.com/absmach/supermq.BuildTime=2025-09-16T08:51:10Z' -X 'github.com/absmach/supermq.Version=v0.3.0' -X 'github.com/absmach/supermq.Commit=1e4e360c2182aa9bd6febb39756e3398fa4139ca'" -o build/cli cmd/cli/main.go
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w -X 'github.com/absmach/supermq.BuildTime=2025-09-16T08:51:10Z' -X 'github.com/absmach/supermq.Version=v0.3.0' -X 'github.com/absmach/supermq.Commit=1e4e360c2182aa9bd6febb39756e3398fa4139ca'" -o build/proxy cmd/proxy/main.go
GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/addition.wasm -target wasip1 examples/addition/addition.go
GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/compute.wasm -target wasip1 examples/compute/compute.go
GOOS=js GOARCH=wasm tinygo build -buildmode=c-shared -o build/hello-world.wasm -target wasip1 examples/hello-world/hello-world.go
```

Installing the artifacts will install Propeller to the `GOBIN` directory. That is:

```bash
cp build/cli $GOBIN/propeller-cli\
cp build/manager $GOBIN/propeller-manager\
cp build/proplet $GOBIN/propeller-proplet\
cp build/proxy $GOBIN/propeller-proxy
```

To build the `sample-wasi-http-rust` example, you will follow the [instructions](https://github.com/bytecodealliance/sample-wasi-http-rust#sample-wasihttp-in-rust).

```bash
git submodule update --init
cd examples/sample-wasi-http-rust
cargo b
```

## Start Docker composition

Start docker composition

```bash
cd propeller
make start-supermq
```

To install the SuperMQ CLI, follow the [instructions](https://docs.supermq.abstractmachines.fr/getting-started#step-2---install-the-cli).

## Provision SuperMQ

In order for propeller to work, we need to provision SuperMQ. This will:

- Login the user with there credentials. If they are not registered, they will need to login using the [supermq-cli](https://docs.supermq.abstractmachines.fr/cli#create-user) or [curl](https://docs.supermq.abstractmachines.fr/api#create-user) or the web interface. This will require you to have [supermq-cli](https://docs.supermq.abstractmachines.fr/cli) installed.
- Create a domain
- Login that user to the domain
- Create a manager client
- Create a proplet client
- Create a manager channel
- Connect the manager client to the manager channel
- Connect the proplet client to the manager channel

This can be done using the following command:

```bash
propeller-cli provision
```

The process will look something like this:

[![asciicast](https://asciinema.org/a/8oYuONLQkvuJ3jdjYdVH97qxH.svg)](https://asciinema.org/a/8oYuONLQkvuJ3jdjYdVH97qxH)

This will output a response like the following

```bash
Successfully created config.toml file
```

If you are running manager and proplet using docker you will need to copy the `config.toml` file to the `docker/config.toml` file. Then uncomment volume mapping lines in the `docker-compose.yml` file. After that you can run `make start-supermq` to start the SuperMQ docker container.

The `config.toml` file will be created in the current directory. This file contains the credentials for the user, domain, manager client, proplet client, and manager channel. It will look something like this:

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

## Start the manager

To start the manager, run the following command

```bash
propeller-manager
```

The logs from the manager will look something like this:

```json
{"time":"2025-06-12T14:13:56.74162598+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:13:56.793894993+03:00","level":"INFO","msg":"Subscribe to MQTT topic completed successfully","duration":"52.272009ms"}
{"time":"2025-06-12T14:13:56.794210043+03:00","level":"INFO","msg":"manager service http server listening at localhost:7070 without TLS"}
```

## Start the proplet

To start the proplet, run the following command

```bash
propeller-proplet
```

The logs from the proplet will look something like this:

```json
{"time":"2025-06-12T14:14:44.362072799+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:14:44.398147897+03:00","level":"INFO","msg":"Proplet service is running."}
```

This will create a proplet automatically on the manager's side.

## Start the proxy

To start the proxy, run the following command

```bash
export PROXY_REGISTRY_URL="docker.io"
export PROXY_AUTHENTICATE="TRUE"
export PROXY_REGISTRY_USERNAME=""
export PROXY_REGISTRY_PASSWORD=""
propeller-proxy
```

The logs from the proxy will look something like this:

```json
{"time":"2025-06-12T14:15:18.438848211+03:00","level":"INFO","msg":"MQTT connection lost"}
{"time":"2025-06-12T14:15:18.438823293+03:00","level":"INFO","msg":"successfully initialized MQTT and HTTP config"}
{"time":"2025-06-12T14:15:18.438886395+03:00","level":"INFO","msg":"starting proxy service"}
{"time":"2025-06-12T14:15:18.452592155+03:00","level":"INFO","msg":"successfully subscribed to topic"}
```

## Postman Colletion

This is a [collection](./api/postman_collection.json) of the API calls that can be used to interact with the Propeller system.

## API

### List Proplets

```bash
curl -X GET "http://localhost:7070/proplets"
```

This will output a response like the following

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

### Create task

```bash
curl -X POST "http://localhost:7070/tasks" \
-H "Content-Type: application/json" \
-d '{"name": "add", "inputs": [10, 20]}'
```

This will output a response like the following

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

To can use the CLI to create a task as follows:

```bash
# propeller-cli tasks create <name>
propeller-cli tasks create demo
```

This will output a response like the following

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

### Get a task

```bash
curl -X GET "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed"
```

This will output a response like the following

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

To can use the CLI to get a task as follows:

```bash
# propeller-cli tasks view <id>
propeller-cli tasks view 2ccb6b7c-3ce8-4c27-be19-01172954d593
```

This will output a response like the following

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

### Upload Wasm File

```bash
curl -X PUT "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/upload" \
-F 'file=@<propeller_path>/build/addition.wasm'
```

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

### Start a task

```bash
curl -X POST "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/start"
```

You can use the CLI to start a task as follows:

```bash
# propeller-cli tasks start <id>
propeller-cli tasks start 2ccb6b7c-3ce8-4c27-be19-01172954d593
```

This will output a response like the following

```bash
ok
```

### Stop a task

```bash
curl -X POST "http://localhost:7070/tasks/e9858e56-a1dd-4e5a-9288-130f7be783ed/stop"
```

### Creating Tasks from OCI Registry Images

For WebAssembly modules stored in an OCI registry, you can specify the image URL during task creation. The proxy will automatically retrieve the WASM file from the registry when the task starts, eliminating the need for manual file uploads.

```bash
curl -X POST "http://localhost:7070/tasks" \
-H "Content-Type: application/json" \
-d '{"name": "add", "inputs": [10, 20], "image_url": "docker.io/mrstevenyaga/add.wasm"}'
```

The proxy will handle pulling the image from the specified OCI registry during task execution, streamlining the deployment process.
