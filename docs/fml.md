# Federated Machine Learning in Propeller

Propeller implements Federated Machine Learning (FML) as a workload-agnostic federated learning framework that enables distributed machine learning training across multiple edge devices without centralizing raw data. This document explains the motivation for federated learning, the high-level architecture of Propeller's FML system, and how the components interact during a training round.

## Motivation for Federated Learning

Federated learning addresses several critical challenges in distributed machine learning:

### Data Locality and Privacy

Traditional centralized machine learning requires moving raw data from edge devices to a central server for training. This approach has significant drawbacks:

- **Privacy Concerns**: Sensitive data (medical records, personal information, proprietary sensor data) must leave the device, creating privacy risks and regulatory compliance challenges.
- **Data Sovereignty**: Organizations may be legally or contractually prohibited from moving data off-premises or across geographic boundaries.
- **Bandwidth Constraints**: Transferring large datasets from edge devices to the cloud consumes significant network bandwidth and may be impractical in bandwidth-constrained environments.

Federated learning solves these problems by keeping raw data on the device. Only model updates (weight gradients or deltas) are transmitted, not the underlying training data. This preserves privacy while enabling collaborative model improvement.

### Distributed Assets and Edge Computing

Modern IoT and edge computing deployments involve thousands or millions of devices distributed across diverse locations:

- **Geographic Distribution**: Devices may be spread across multiple sites, cities, or countries, making centralized data collection impractical.
- **Resource Constraints**: Edge devices often have limited storage, compute, and network capabilities, making them unsuitable for large-scale centralized training.
- **Real-time Requirements**: Many applications require models that adapt to local conditions in real-time, which is difficult to achieve with centralized training.

Federated learning leverages the distributed nature of edge deployments by training models locally on each device, then aggregating the learned knowledge without moving raw data.

### Scalability and Efficiency

Federated learning provides natural scalability advantages:

- **Parallel Training**: Multiple devices train simultaneously, reducing overall training time compared to sequential centralized training.
- **Reduced Server Load**: The central coordinator only aggregates updates, not raw data, significantly reducing computational and storage requirements.
- **Incremental Learning**: New devices can join the federation without retraining from scratch, and models can be updated incrementally as new data becomes available.

## Architecture

Propeller's FML system is built on a workload-agnostic design where the core orchestration layer (Manager) has no FL-specific logic. Instead, FL-specific functionality is handled by an external Coordinator service that manages rounds, aggregation, and model versioning. This separation of concerns allows Propeller to support federated learning while remaining flexible enough to orchestrate other types of distributed workloads.

### Core Design Principles

1. **Workload-Agnostic Manager**: The Manager service orchestrates task distribution and message forwarding without understanding FL semantics. It treats FL tasks like any other workload, creating tasks and forwarding messages verbatim.

2. **External Coordinator**: FL-specific logic (round management, aggregation algorithms, model versioning) is implemented in a separate Coordinator service that can be developed, deployed, and scaled independently.

3. **MQTT-Based Communication**: All components communicate via SuperMQ MQTT topics, providing asynchronous, scalable message passing that works across diverse network conditions and device types.

4. **WASM-Based Training**: Training workloads execute as WebAssembly modules, providing portability, security isolation, and consistent execution across different device architectures.

The following diagram illustrates the architecture and message flow of Propeller's federated learning system:

```text
                         ┌──────────────────────┐
                         │  External Trigger    │
                         │   (API/Script)        │
                         └───────────┬──────────┘
                                     │
                                     │ fl/rounds/start
                                     ▼
                         ┌──────────────────────┐
                         │     Coordinator      │
                         │  (FL Logic + FedAvg) │
                         └───────────┬──────────┘
                                     │
                                     │ fl/rounds/start
                                     ▼
                                ┌──────────┐
                                │ Manager  │
                                │(Task     │
                                │ Orchestrator)│
                                └────┬─────┘
                                     │
                                     │ Task Start Commands
                                     │ m/{domain}/c/{channel}/control/manager/start
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
  ┌──────────┐                 ┌──────────┐                 ┌──────────┐
  │ Proplet 1│                 │ Proplet 2│                 │ Proplet 3│
  │ (Wasm FL)│                 │ (Wasm FL)│                 │ (Wasm FL)│
  └────┬─────┘                 └────┬─────┘                 └────┬─────┘
       │                            │                            │
       │ fl/rounds/{round_id}/updates/{proplet_id}              │
       └────────────────────────────┼────────────────────────────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │   Manager   │
                             │  (Forwards  │
                             │  Updates)   │
                             └───────┬─────┘
                                     │
                                     │ fml/updates
                                     ▼
                         ┌──────────────────────┐
                         │     Coordinator      │
                         │ Collect + Aggregate  │
                         └───────────┬──────────┘
                                     │
                                     │ fl/models/publish
                                     ▼
                              ┌──────────────┐
                              │ Model Registry│
                              │  (Storage &   │
                              │ Distribution) │
                              └───────┬──────┘
                                      │
                                      │ fl/models/global_model_v{N}
                                      │ (Retained Message)
                                      ▼
                          ┌─────────────────────────┐
                          │        Proplets         │
                          │    (Model Receiver)     │
                          └─────────────────────────┘
```

## System Components

Propeller's FML system consists of the following components that work together to enable federated learning:

### Manager Service

The Manager is Propeller's core orchestration component. In the context of federated learning, it acts as a workload-agnostic task distributor and message forwarder.

**Responsibilities**:

- **Task Creation and Distribution**: When a federated learning round starts, the Manager receives a round start message and creates training tasks for each participating proplet (edge device). Each task is configured with the necessary environment variables (round ID, model URI, hyperparameters) and pinned to a specific proplet.

- **Message Forwarding**: The Manager subscribes to FL update topics and forwards update messages verbatim to the Coordinator. It does not inspect, validate, or modify the update payload, maintaining its workload-agnostic design.

- **Proplet Management**: The Manager maintains awareness of available proplets and their health status, ensuring tasks are only created for active, reachable devices.

**Key Design**: Propeller's Manager remains completely workload-agnostic. It doesn't understand federated learning semantics, model structures, or aggregation logic. This separation allows Propeller's Manager to orchestrate other types of distributed workloads beyond federated learning.

### FML Coordinator

The Coordinator is the FL-specific service that manages the federated learning lifecycle, from round initialization through aggregation to model publication.

**Responsibilities**:

- **Round State Management**: The Coordinator maintains state for each active training round, tracking which proplets have submitted updates, timing information, and completion status.

- **Update Collection**: The Coordinator receives training updates from proplets (forwarded by the Manager) and collects them until sufficient updates are received to trigger aggregation.

- **Federated Averaging**: When the minimum number of updates (k-of-n) is received, the Coordinator performs weighted federated averaging. Each update is weighted by the number of training samples used, then all weighted updates are averaged to produce a new global model.

- **Model Versioning**: The Coordinator maintains a version counter for global models, incrementing it each time a new aggregated model is created. This enables tracking of model evolution over multiple training rounds.

- **Round Completion**: The Coordinator handles round completion, either when sufficient updates are received or when a timeout is reached. It publishes completion notifications and triggers model publication.

- **Timeout Handling**: The Coordinator monitors each round for timeouts. If a round doesn't receive sufficient updates within the specified timeout period, it aggregates whatever updates have been received (if any) and completes the round.

**State Management**: The Coordinator maintains round state in memory, with thread-safe access patterns to handle concurrent updates from multiple proplets. Each round has its own mutex to protect its update list while allowing parallel processing of different rounds.

### Model Registry

The Model Registry is responsible for storing, versioning, and distributing global models to proplets.

**Responsibilities**:

- **Model Storage**: The Model Registry persists aggregated models to disk, maintaining a version history that allows proplets to fetch specific model versions.

- **Model Distribution**: When a new model is published by the Coordinator, the Model Registry receives it and makes it available via HTTP endpoints. Proplets can fetch models by version number.

- **Initial Model Provisioning**: The Model Registry provides an initial model (version 0) that serves as the starting point for the first training round.

**Model Lifecycle**: Models progress through versions as training rounds complete. Each round produces a new version that incorporates the knowledge learned from all participating proplets. Proplets fetch the latest model version at the start of each round, train on it locally, and submit updates that contribute to the next version.

### Proplet Service (Edge Workers)

Proplets are the edge devices that execute training workloads. They run WebAssembly modules that perform local training on device-resident data.

**Responsibilities**:

- **WASM Execution**: Proplets execute WebAssembly training modules using a WASM runtime (Wasmtime for Rust proplets, WAMR for embedded proplets). The runtime provides isolation, security, and portability.

- **Data Access**: Proplets fetch the current global model from the Model Registry and access local training datasets. The model and dataset are provided to the WASM module via environment variables or host functions, depending on the proplet implementation.

- **Local Training**: The WASM module performs training iterations on local data, updating model weights based on the local dataset. This training happens entirely on the device without exposing raw data.

- **Update Generation**: After training completes, the proplet captures the training output (model weight updates) and formats it as a federated learning update message containing the round ID, proplet ID, number of training samples, metrics, and weight deltas.

- **Update Submission**: Proplets submit updates to the Coordinator, either via HTTP POST (preferred for Rust proplets) or MQTT publish (fallback or for embedded proplets). The update is forwarded by the Manager to the Coordinator for aggregation.

**Proplet Variants**: Propeller supports two proplet implementations optimized for different environments:

- **Rust Proplet**: Full-featured implementation using Wasmtime runtime, suitable for edge servers, gateways, and devices with sufficient resources. Supports HTTP-first update submission with MQTT fallback.

- **Embedded Proplet**: Lightweight implementation using WAMR runtime, suitable for constrained microcontrollers. Uses host functions for data access and MQTT for all communication.

### Client WASM Module

The Client WASM module is the portable training workload that runs on each proplet. It contains the machine learning training logic but is agnostic to the federated learning infrastructure.

**Responsibilities**:

- **Model Initialization**: The WASM module receives the current global model (via environment variables or host functions) and initializes its local training state.

- **Local Training**: The module performs training iterations on the local dataset, applying the specified hyperparameters (learning rate, batch size, epochs). Training happens entirely within the WASM sandbox.

- **Update Computation**: After training, the module computes weight updates (deltas or new weights) that represent what was learned from the local data.

- **Output Generation**: The module outputs a JSON-formatted update message to stdout, which is captured by the proplet runtime and submitted to the Coordinator.

**Portability**: In Propeller, because the training logic is compiled to WebAssembly, the same WASM module can run on different proplet types (Rust or embedded) without modification, as long as the data access interface (environment variables or host functions) is consistent.

### SuperMQ MQTT Infrastructure

SuperMQ provides the underlying MQTT messaging infrastructure that enables asynchronous communication between all components.

**Responsibilities**:

- **Message Bus**: SuperMQ acts as a central message bus, allowing components to publish and subscribe to topics without direct point-to-point connections.

- **Topic-Based Routing**: Components communicate via well-defined topic patterns (e.g., `fl/rounds/start`, `fl/rounds/{round_id}/updates/{proplet_id}`), enabling loose coupling and scalability.

- **Retained Messages**: SuperMQ supports retained messages, allowing newly subscribed components to immediately receive the latest model version without waiting for the next publication.

- **Quality of Service**: MQTT's QoS levels ensure reliable message delivery even in unreliable network conditions, critical for distributed edge deployments.

## Training Round Lifecycle

The following diagram shows the complete message flow during a federated learning round:

```text
1. Round Start
   ┌─────────────────────────────────────┐
   │ External trigger / test script     │
   │ publishes to: fl/rounds/start      │
   └──────────────┬──────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
   ┌────▼────┐        ┌─────▼─────┐
   │ Manager │        │ Coordinator│
   │ (creates│        │ (initializes│
   │  tasks) │        │  round)    │
   └────┬────┘        └────────────┘
        │
        │ Publishes start commands
        │ to: m/{domain}/c/{channel}/control/manager/start
        │
   ┌────▼──────────────────────────────┐
   │ Proplets receive start commands   │
   │ Execute WASM modules              │
   └────┬──────────────────────────────┘
        │
        │ After training, publish updates
        │ to: fl/rounds/{round_id}/updates/{proplet_id}
        │
   ┌────▼────┐
   │ Manager │ (forwards verbatim)
   └────┬────┘
        │
        │ Publishes to: fml/updates
        │
   ┌────▼─────┐
   │Coordinator│ (aggregates when k_of_n reached)
   └────┬──────┘
        │
        │ Publishes to: fl/models/publish
        │
   ┌────▼──────────┐
   │ Model Registry│ (saves and republishes)
   └────┬──────────┘
        │
        │ Publishes to: fl/models/global_model_v{N}
        │ (retained message)
```

### 1. Round Initialization

An external trigger (test script, API call, or scheduled job) publishes a round start message to the `fl/rounds/start` MQTT topic. This message contains:

- Round identifier
- Model URI (pointing to the current global model version)
- List of participating proplet IDs
- Training hyperparameters (learning rate, batch size, epochs)
- Minimum number of updates required (k-of-n)
- Round timeout duration

Both the Manager and Coordinator subscribe to this topic and process the message:

- **Manager**: Creates training tasks for each participating proplet, configuring each task with the round ID, model URI, and hyperparameters as environment variables. Tasks are started immediately.

- **Coordinator**: Initializes round state, creating a tracking structure that will collect updates until the k-of-n threshold is reached or timeout occurs.

### 2. Task Execution

Each proplet receives its task start command from the Manager and begins execution:

- **Model Fetching**: The proplet fetches the current global model from the Model Registry using the model URI provided in the task configuration.

- **Dataset Access**: The proplet accesses its local training dataset. This may be fetched from a local data store or accessed directly from device storage.

- **WASM Execution**: The proplet launches the WASM training module, providing the model and dataset via environment variables or host functions. The WASM module performs local training iterations, updating weights based on the local data.

- **Update Generation**: After training completes, the WASM module outputs a JSON update message containing the learned weight changes, number of training samples, and any training metrics.

### 3. Update Collection

Proplets submit their updates to the Coordinator:

- **Update Submission**: Each proplet publishes its update to an MQTT topic specific to that proplet and round, or posts it directly to the Coordinator via HTTP.

- **Message Forwarding**: If submitted via MQTT, the Manager forwards the update message verbatim to the Coordinator's update topic. The Manager does not inspect or modify the update.

- **Update Collection**: The Coordinator receives each update and adds it to the round's update collection. The Coordinator tracks which proplets have submitted updates and maintains a count.

### 4. Aggregation

When the Coordinator receives the minimum number of updates (k-of-n), it triggers aggregation:

- **Weight Extraction**: The Coordinator extracts weight updates from each collected update message. Each update is weighted by the number of training samples used by that proplet.

- **Federated Averaging**: The Coordinator performs weighted averaging: it sums all weighted updates and normalizes by the total number of training samples across all updates. This produces a new global model that incorporates knowledge from all participating proplets.

- **Version Increment**: The Coordinator increments the model version counter, creating a new version number for the aggregated model.

- **Model Persistence**: The new global model is saved to the Model Registry, which persists it to disk and makes it available for the next round.

### 5. Model Distribution

The aggregated model is distributed to proplets for use in subsequent rounds:

- **Model Publication**: The Coordinator publishes the new model to the Model Registry via a publish topic.

- **Registry Update**: The Model Registry receives the new model, saves it with the new version number, and makes it available via HTTP endpoints.

- **Retained Message**: The Model Registry also publishes the model to an MQTT topic as a retained message, allowing proplets that subscribe later to immediately receive the latest version.

### 6. Round Completion

The Coordinator handles round completion:

- **Completion Notification**: The Coordinator publishes a round completion message containing the round ID, new model version, number of updates received, and completion timestamp.

- **Timeout Handling**: If a round times out before receiving k-of-n updates, the Coordinator aggregates whatever updates were received (if any) and completes the round. This ensures progress even if some proplets fail or are slow to respond.

- **State Cleanup**: After completion, the Coordinator may clean up round state, though some implementations maintain history for monitoring and debugging.

## Communication Patterns

Propeller's FML system uses several communication patterns to coordinate distributed training:

### Communication Flow

Propeller combines MQTT publish-subscribe and HTTP request-response patterns:

```text
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Proplet    │         │   Manager   │         │ Coordinator │
│             │         │             │         │             │
│ 1. Fetch    │────────▶│             │         │             │
│    Model    │  HTTP   │             │         │             │
│    (GET)    │         │             │         │             │
│             │◀────────│             │         │             │
│             │         │             │         │             │
│ 2. Train    │         │             │         │             │
│    locally  │         │             │         │             │
│             │         │             │         │             │
│ 3. Submit   │────────▶│  Forward    │────────▶│  Aggregate  │
│    Update   │  MQTT   │  (verbatim) │  MQTT   │             │
│             │         │             │         │             │
│             │         │             │         │             │
│ 4. Receive  │◀────────│             │         │             │
│    New      │  MQTT   │             │         │  Publish    │
│    Model    │(retained)│             │         │  New Model  │
│             │         │             │         │             │
└─────────────┘         └─────────────┘         └─────────────┘
        │                       │                       │
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                          SuperMQ MQTT
                          Message Bus
```

### Publish-Subscribe (MQTT Topics)

Most communication uses MQTT's publish-subscribe pattern:

- **Round Start**: External triggers publish to `fl/rounds/start`, and both Manager and Coordinator subscribe to initialize the round.

- **Update Submission**: Proplets publish to `fl/rounds/{round_id}/updates/{proplet_id}`, the Manager subscribes to forward updates, and the Coordinator subscribes to collect them.

- **Model Distribution**: The Model Registry publishes to `fl/models/global_model_v{N}` as retained messages, allowing proplets to fetch the latest model.

- **Round Completion**: The Coordinator publishes to `fl/rounds/{round_id}/complete` to notify external systems of round completion.

### Request-Response (HTTP)

Some interactions use HTTP for direct, synchronous communication:

- **Model Fetching**: Proplets fetch models from the Model Registry via HTTP GET requests, providing a simple, reliable way to retrieve specific model versions.

- **Update Submission (Rust Proplet)**: Rust proplets prefer HTTP POST to submit updates directly to the Coordinator, providing lower latency and better error handling than MQTT in reliable network conditions.

- **Dataset Access**: Proplets may fetch datasets from a local data store via HTTP, though datasets can also be accessed directly from device storage.

### Hybrid Approach

Propeller uses a hybrid approach that combines the strengths of both patterns:

- **MQTT for Orchestration**: MQTT's asynchronous, topic-based routing is ideal for coordinating distributed rounds across many devices.

- **HTTP for Data Transfer**: HTTP's request-response model is better suited for fetching large model artifacts and submitting updates when network conditions are reliable.

- **Fallback Mechanisms**: Proplets can fall back from HTTP to MQTT if HTTP requests fail, ensuring reliability in diverse network conditions.

## Model Lifecycle and Versioning

Models in Propeller's FML system progress through versions as training rounds complete:

### Initial Model

The process begins with an initial model (version 0) that serves as the starting point. This model may be:

- A randomly initialized model with zero or small random weights
- A pre-trained model from a previous training session
- A model trained on a small central dataset

The initial model is stored in the Model Registry and made available to all proplets.

### Training Rounds

Each training round follows this pattern:

1. **Model Distribution**: Proplets fetch the current global model version (e.g., version N) from the Model Registry.

2. **Local Training**: Each proplet trains on the global model using its local dataset, producing weight updates.

3. **Aggregation**: The Coordinator aggregates updates from k proplets, producing a new global model (version N+1).

4. **Model Update**: The new model is stored in the Model Registry and becomes the current version for the next round.

### Incremental Improvement

Each round incrementally improves the model by incorporating knowledge from participating proplets. The federated averaging algorithm ensures that:

- Updates from proplets with more training samples have greater influence on the aggregated model
- The model converges toward a solution that works well across all participating devices' data distributions
- No single proplet's data dominates the final model

### Version History

The Model Registry maintains a version history, allowing:

- **Rollback**: If a new model version performs poorly, Propeller can roll back to a previous version.

- **Analysis**: Researchers and operators can compare model versions to understand how the model evolved over time.

- **Reproducibility**: Specific model versions can be referenced and reproduced for testing and validation.

## Scalability and Performance Considerations

Propeller's FML architecture is designed to scale across several dimensions:

### Horizontal Scaling

- **Multiple Proplets**: Propeller naturally scales to support hundreds or thousands of proplets participating in a single round. The Manager can create tasks for all participants in parallel.

- **Multiple Coordinators**: While Propeller's current implementation uses a single Coordinator, the architecture supports multiple Coordinators with consistent hashing or round assignment to distribute load.

- **Distributed Model Registry**: The Model Registry can be replicated or sharded to handle high request volumes from many proplets fetching models simultaneously.

### Network Efficiency

- **Chunked Transport**: Propeller automatically chunks large model artifacts for efficient MQTT transport, allowing models to be distributed even over bandwidth-constrained networks.

- **Retained Messages**: Propeller uses MQTT retained messages to allow proplets to immediately receive the latest model when they subscribe, reducing latency and avoiding missed updates.

- **Asynchronous Communication**: Propeller leverages MQTT's asynchronous nature to allow proplets to submit updates without blocking, and the Coordinator can process updates as they arrive.

### Fault Tolerance

- **Timeout Handling**: Propeller ensures rounds complete even if some proplets fail to submit updates, ensuring progress despite device failures or network issues.

- **Update Thresholds**: The k-of-n parameter allows rounds to complete with a subset of participants, providing resilience to device failures.

- **Fallback Mechanisms**: Propeller's proplets can fall back from HTTP to MQTT if network conditions degrade, ensuring updates are delivered even in challenging network environments.

## Security and Privacy

Federated learning inherently provides privacy benefits, but Propeller includes additional security considerations:

### Data Privacy

- **No Raw Data Transmission**: Only model weight updates are transmitted, never raw training data. This provides strong privacy guarantees even if messages are intercepted.

- **Local Training**: In Propeller, all training happens on-device within the WASM sandbox, ensuring that raw data never leaves the device's secure execution environment.

- **Isolated Execution**: Propeller leverages WASM's sandboxing to provide isolation between the training workload and the proplet's host system, preventing data leakage through side channels.

### Communication Security

- **SuperMQ Authentication**: In Propeller, all MQTT communication is authenticated via SuperMQ's client authentication system, ensuring only authorized components can participate.

- **Encrypted Transport**: MQTT connections can use TLS to encrypt messages in transit, protecting updates from interception or tampering.

- **Topic Access Control**: Propeller uses SuperMQ's topic-based access control to ensure that proplets can only publish to their designated update topics and cannot access other proplets' updates.

### Model Security

- **Model Integrity**: Propeller cryptographically hashes and versions model versions, allowing detection of tampering or corruption.

- **Access Control**: The Model Registry can implement access control to ensure only authorized proplets can fetch models.

## Demo Application

For detailed setup instructions, step-by-step guide, and hands-on examples of running federated learning with Propeller, see the [FML Demo README](https://github.com/absmach/propeller/blob/2a17f0c45617be08cbc1c6ed461479ecb6cefddb/examples/fl-demo/README.md).
