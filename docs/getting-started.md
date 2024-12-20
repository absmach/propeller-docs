# Getting Started

Before proceeding, install the following prerequisites:

- [A Go compiler (Go 1.23 or later)](https://go.dev/doc/install)
- [Make](https://www.gnu.org/software/make/manual/make.html)
- [Docker](https://docs.docker.com/)
- [Wasmtime](https://wasmtime.dev/)
- [TinyGo](https://tinygo.org/getting-started/install/)
- [Magistrala CLI](https://github.com/absmach/magistrala)
- [Mosquitto](https://mosquitto.org/)

## Start Docker composition

Start docker composition

```bash
cd propeller
make start-magistrala
```

To install the Magistrala CLI, follow the instructions [here](https://docs.magistrala.abstractmachines.fr/getting-started/#step-2-install-the-cli).

## Provision Magistrala

Login as admin user

```bash
USER_TOKEN=$(magistrala-cli users token admin 12345678 | jq -r .access_token)
```

Create a domain

```bash
DOMAIN_ID=$(magistrala-cli domains create demo demo $USER_TOKEN | jq -r .id)
```

Create a thing called manager

```bash
magistrala-cli things create '{"name": "Propeller Manager", "tags": ["manager", "propeller"], "status": "enabled"}' $DOMAIN_ID $USER_TOKEN
```

This will output a response like the following

```json
{
  "created_at": "2024-12-20T09:56:05.241227Z",
  "credentials": {
    "secret": "64b3742e-beee-4bd9-8673-a7b1dbfe4115"
  },
  "domain_id": "c1908400-701b-4f55-82ae-45a5997b2df6",
  "id": "70fc2b08-a2ce-4294-8003-aeb3df0ff505",
  "name": "Propeller Manager",
  "status": "enabled",
  "tags": ["manager", "propeller"],
  "updated_at": "0001-01-01T00:00:00Z"
}
```

Set the following environment variables from the respose

```bash
export MANAGER_THING_ID="<id>"
export MANAGER_THING_KEY="<secret>"
```

For example

```bash
export MANAGER_THING_ID="70fc2b08-a2ce-4294-8003-aeb3df0ff505"
export MANAGER_THING_KEY="64b3742e-beee-4bd9-8673-a7b1dbfe4115"
```

Create a channel called manager

```bash
magistrala-cli channels create '{"name": "Propeller Manager", "tags": ["manager", "propeller"], "status": "enabled"}' $DOMAIN_ID $USER_TOKEN
```

```json
{
  "created_at": "2024-12-20T09:57:12.510144Z",
  "domain_id": "c1908400-701b-4f55-82ae-45a5997b2df6",
  "id": "f8201a3c-7fd3-4468-bc85-8824ec0ab4d3",
  "name": "Propeller Manager",
  "status": "enabled",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

Set the following environment variables from the respose

```bash
export MANAGER_CHANNEL_ID="<id>"
```

For example

```bash
export MANAGER_CHANNEL_ID="f8201a3c-7fd3-4468-bc85-8824ec0ab4d3"
```

Connect the thing to the manager channel

```bash
magistrala-cli things connect $MANAGER_THING_ID $MANAGER_CHANNEL_ID $DOMAIN_ID $USER_TOKEN
```

Create a thing called proplet

```bash
magistrala-cli things create '{"name": "Propeller Proplet", "tags": ["proplet", "propeller"], "status": "enabled"}' $DOMAIN_ID $USER_TOKEN
```

```json
{
  "created_at": "2024-12-20T09:58:00.282984Z",
  "credentials": {
    "secret": "ab8543bd-1f4b-4df1-b252-4d35c7aaffa2"
  },
  "domain_id": "c1908400-701b-4f55-82ae-45a5997b2df6",
  "id": "65f31506-80f1-48f4-b2d2-ff2487d4baad",
  "name": "Propeller Proplet",
  "status": "enabled",
  "tags": ["proplet", "propeller"],
  "updated_at": "0001-01-01T00:00:00Z"
}
```

Set the following environment variables from the respose

```bash
export PROPLET_THING_ID="<id>"
export PROPLET_THING_KEY="<secret>"
```

For example

```bash
export PROPLET_THING_ID="65f31506-80f1-48f4-b2d2-ff2487d4baad"
export PROPLET_THING_KEY="ab8543bd-1f4b-4df1-b252-4d35c7aaffa2"
```

Connect the thing to the manager channel

```bash
magistrala-cli things connect $PROPLET_THING_ID $MANAGER_CHANNEL_ID $DOMAIN_ID $USER_TOKEN
```

## Start the manager

To start the manager, run the following command

```bash
export MANAGER_THING_ID=""
export MANAGER_THING_KEY=""
export PRMANAGER_CHANNEL_ID=""
export PROPLET_THING_ID=""
export PROPLET_THING_KEY=""
propeller-manager
```

## Start the proplet

To start the proplet, run the following command

```bash
export MANAGER_THING_ID=""
export MANAGER_THING_KEY=""
export PROPLET_CHANNEL_ID=""
export PROPLET_THING_ID=""
export PROPLET_THING_KEY=""
propeller-proplet
```

## Start the proxy

To start the proxy, run the following command

```bash
export PROXY_REGISTRY_URL=""
export PROXY_AUTHENTICATE="TRUE"
export PROXY_REGISTRY_USERNAME=""
export PROXY_REGISTRY_PASSWORD=""
export PROPLET_CHANNEL_ID=""
export PROPLET_THING_ID=""
export PROPLET_THING_KEY=""
propeller-proxy
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
      "id": "65f31506-80f1-48f4-b2d2-ff2487d4baad",
      "name": "Edouard-Harker",
      "task_count": 0,
      "alive": true,
      "alive_history": [
        "2024-12-20T13:06:40.004843025+03:00",
        "2024-12-20T13:06:50.004307995+03:00",
        "2024-12-20T13:07:00.005793874+03:00",
        "2024-12-20T13:07:10.005762532+03:00",
        "2024-12-20T13:07:20.006582332+03:00",
        "2024-12-20T13:07:30.005886582+03:00",
        "2024-12-20T13:07:40.005318901+03:00",
        "2024-12-20T13:07:50.003822571+03:00",
        "2024-12-20T13:08:00.006378219+03:00",
        "2024-12-20T13:08:10.005855688+03:00"
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
  "id": "ee8012e7-f3b1-47f1-a109-b21eb3b0e21d",
  "name": "add",
  "state": 0,
  "inputs": [10, 20],
  "start_time": "0001-01-01T00:00:00Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "created_at": "2024-12-20T13:09:28.925730577+03:00",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

### Get a task

```bash
curl -X GET "http://localhost:7070/tasks/e5bcc74e-9af3-4f09-b663-44dc260ab809"
```

This will output a response like the following

```json
{
  "id": "1a211574-987c-4213-9266-af1640e1af95",
  "name": "add",
  "state": 0,
  "inputs": [10, 20],
  "start_time": "0001-01-01T00:00:00Z",
  "finish_time": "0001-01-01T00:00:00Z",
  "created_at": "2024-12-20T13:10:37.848159052+03:00",
  "updated_at": "0001-01-01T00:00:00Z"
}
```

### Upload Wasm File

```bash
curl -X PUT "http://localhost:7070/tasks/e5bcc74e-9af3-4f09-b663-44dc260ab809/upload" \
-F 'file=@<propeller_path>/build/addition.wasm'
```

### Start a task

```bash
curl -X POST "http://localhost:7070/tasks/e5bcc74e-9af3-4f09-b663-44dc260ab809/start"
```

### Stop a task

```bash
curl -X POST "http://localhost:7070/tasks/e5bcc74e-9af3-4f09-b663-44dc260ab809/stop"
```

### Creating Tasks from OCI Registry Images

For WebAssembly modules stored in an OCI registry, you can specify the image URL during task creation. The proxy will automatically retrieve the WASM file from the registry when the task starts, eliminating the need for manual file uploads.

```bash
curl -X POST "http://localhost:7070/tasks" \
-H "Content-Type: application/json" \
-d '{"name": "add", "inputs": [10, 20], "image_url": "docker.io/mrstevenyaga/add.wasm"}'
```

The proxy will handle pulling the image from the specified OCI registry during task execution, streamlining the deployment process.
