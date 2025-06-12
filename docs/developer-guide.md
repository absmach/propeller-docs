# Developer's Guide

## Getting Propeller

Propeller source can be found in the official Propeller GitHub repository. You should fork this repository in order to make changes to the project. The forked version of the repository should be cloned using the following:

```bash
git clone https://github.com/your-github-username/propeller.git $SOMEPATH/propeller
cd $SOMEPATH/propeller
```

## Building Propeller

### Prerequisites

To build Propeller, you will need the following:

- [A Go compiler (Go 1.23 or later)](https://go.dev/doc/install)
- [Make](https://www.gnu.org/software/make/manual/make.html)
- [Docker](https://docs.docker.com/)
- [Wasmtime](https://wasmtime.dev/)
- [TinyGo](https://tinygo.org/getting-started/install/)

### Building

Use the GNU Make tool to build all Propeller services:

```bash
make all
```

This will build Propeller for your platforms.

To build Propeller for other platforms, use the following:

| OS      | Architecture | Command                              |
| ------- | ------------ | ------------------------------------ |
| Linux   | amd64        | `GOOS=linux GOARCH=amd64 make all`   |
| Linux   | arm64        | `GOOS=linux GOARCH=arm64 make all`   |
| Windows | amd64        | `GOOS=windows GOARCH=amd64 make all` |
| Darwin  | amd64        | `GOOS=darwin GOARCH=amd64 make all`  |

### Building an individual service

You can build individual services using the following:

```bash
make <service>
```

For example, to build the `manager` service, use the following:

```bash
make manager
```

The built binaries will be located in the `build` directory.

### Building examples

You can build examples using the following:

```bash
make <example>
```

For example, to build the `addition` example, use the following:

```bash
make addition
```

This compiles the addition example to wasm and can be located in the `build` directory.

To test the addition example, use the following:

```bash
wasmtime --invoke add ./build/addition.wasm 1 2
```

This will output something like:

```bash
warning: using `--invoke` with a function that takes arguments is experimental and may break in the future
warning: using `--invoke` with a function that returns values is experimental and may break in the future
3
```

## Installing

Once you have built Propeller, you can install it using the following:

```bash
make install
```

This will install Propeller to the `GOBIN` directory.

## Linter

Propeller uses [golangci-lint](https://golangci-lint.run/) to lint the code. You can run the linter using the following:

```bash
make lint
```

## SuperMQ

### Starting SuperMQ

To start SuperMQ, use the following:

```bash
make start-supermq
```

This will in the background run `docker compose -f docker/compose.yaml up -d` which will start the SuperMQ services.

You can override the configuration or add some extra parameters to the docker compose configuration.

### Stopping SuperMQ

SuperMQ can be stopped using the following:

```bash
make stop-supermq
```
