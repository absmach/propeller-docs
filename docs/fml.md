# Federated Machine Learning

The FML (Federated Machine Learning) system is implemented as a **workload-agnostic** federated learning framework built on top of Propeller's generic orchestration capabilities. The system enables distributed machine learning training across multiple edge devices (proplets) without centralizing raw data.

### Key Design Principles

1. **Manager is Workload-Agnostic**: The Manager service has no FL-specific logic. It simply orchestrates task distribution and forwards messages.
2. **External Coordinator**: FL-specific logic (aggregation, round management, model versioning) is handled by an external FML Coordinator service.
3. **MQTT-Based Communication**: All components communicate via MQTT topics for asynchronous, scalable message passing.
4. **WASM-Based Training**: Training workloads are executed as WebAssembly modules for portability and security.

---

## Architecture

The FML system consists of the following components:

```
                         ┌──────────────────────┐
                         │  External Trigger    │
                         │   Test Script        │
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
                              │  Model Server│
                              │  (MQTT relay)│
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

### Component Overview

1. **MQTT Broker** (Eclipse Mosquitto): Central message bus
2. **Manager**: Task orchestration and message forwarding
3. **FML Coordinator**: FL round management and aggregation
4. **Model Server**: Model storage and distribution
5. **Proplets** (3 instances): WASM execution environments
6. **Client WASM**: Training workload module

---

## Component Details

### 1. Manager Service

**Location**: `manager/service.go`

**Responsibilities**:
- Task creation and lifecycle management
- Proplet selection and task distribution
- MQTT message forwarding (workload-agnostic)

**Key Functions**:

#### `handleRoundStart(ctx context.Context)`
- **Subscribes to**: `fl/rounds/start`
- **Purpose**: Listens for FL round start messages and launches tasks for each participant
- **Process**:
  1. Parses round start message containing:
     - `round_id`: Unique identifier for the round
     - `model_uri`: MQTT topic for the base model (e.g., `fl/models/global_model_v0`)
     - `task_wasm_image`: OCI image reference for WASM module (optional, can use `file` field)
     - `participants`: List of proplet IDs to participate
     - `hyperparams`: Training hyperparameters (epochs, lr, batch_size)
     - `k_of_n`: Minimum number of updates required for aggregation
     - `timeout_s`: Round timeout in seconds
  2. Validates each participant (checks if proplet exists and is alive)
  3. Creates a task for each participant with:
     - Environment variables: `ROUND_ID`, `MODEL_URI`, `HYPERPARAMS`
     - Task name: `fl-round-{round_id}-{proplet_id}`
     - Pinned to specific proplet
  4. Starts each task immediately after creation

**Code Location**: `manager/service.go:485-583`

#### `handleUpdateForward(ctx context.Context)`
- **Subscribes to**: `fl/rounds/+/updates/+` (wildcard pattern)
- **Purpose**: Forwards FL update messages verbatim to the FML coordinator
- **Process**:
  1. Extracts `round_id` and `proplet_id` from topic: `fl/rounds/{round_id}/updates/{proplet_id}`
  2. Adds metadata: `forwarded_at` timestamp
  3. Publishes to: `fml/updates` topic
  4. Does NOT inspect, validate, or modify the update payload

**Code Location**: `manager/service.go:585-621`

**Key Design**: Manager remains completely workload-agnostic. It doesn't understand FL semantics, only forwards messages.

### 2. FML Coordinator

**Location**: `examples/fl-demo/coordinator/main.go`

**Responsibilities**:
- Round state management
- Update aggregation using FedAvg (Federated Averaging)
- Model versioning
- Round completion handling

**Key Data Structures**:

```go
type RoundState struct {
    RoundID   string
    ModelURI  string
    KOfN      int           // Minimum updates required
    TimeoutS  int           // Round timeout in seconds
    StartTime time.Time
    Updates   []Update      // Collected updates
    Completed bool
    mu        sync.Mutex    // Per-round mutex
}

type Update struct {
    RoundID      string                 `json:"round_id"`
    PropletID    string                 `json:"proplet_id"`
    BaseModelURI string                 `json:"base_model_uri"`
    NumSamples   int                    `json:"num_samples"`
    Metrics      map[string]interface{} `json:"metrics"`
    Update       map[string]interface{} `json:"update"`  // Model weights
    ForwardedAt  string                 `json:"forwarded_at,omitempty"`
}

type Model struct {
    W       []float64 `json:"w"`  // Weights
    B       float64   `json:"b"`  // Bias
    Version int       `json:"version"`
}
```

**Key Functions**:

#### `handleRoundStart(client mqtt.Client, msg mqtt.Message)`
- **Subscribes to**: `fl/rounds/start`
- **Purpose**: Initializes round state when a round starts
- **Process**:
  1. Parses round start message
  2. Creates `RoundState` with:
     - Default `k_of_n = 3` if not specified
     - Default `timeout_s = 30` if not specified
  3. Stores in `rounds` map keyed by `round_id`
  4. Logs round initialization

**Code Location**: `coordinator/main.go:98-142`

#### `handleUpdate(client mqtt.Client, msg mqtt.Message)`
- **Subscribes to**: `fml/updates`
- **Purpose**: Receives and processes FL updates from proplets
- **Process**:
  1. Parses update message
  2. **Lazy Initialization**: If round doesn't exist, creates it with defaults
     - This handles cases where tasks are started via HTTP API (test script) without MQTT round start message
  3. Adds update to round's update list
  4. Checks if `len(updates) >= k_of_n`
  5. If threshold reached:
     - Marks round as completed
     - Triggers `aggregateAndAdvance()` in goroutine

**Code Location**: `coordinator/main.go:144-206`

#### `aggregateAndAdvance(round *RoundState)`
- **Purpose**: Performs FedAvg aggregation and creates new global model
- **Algorithm**: Weighted Federated Averaging
  - For each update, weight by `num_samples`
  - Sum weighted updates: `aggregated_w[i] += update.w[i] * num_samples`
  - Normalize by total samples: `aggregated_w[i] /= total_samples`
- **Process**:
  1. Extracts updates from round state (with mutex protection)
  2. Initializes aggregated model from first update's structure
  3. Performs weighted aggregation:
     ```go
     weight := float64(update.NumSamples)
     totalSamples += update.NumSamples
     aggregatedW[i] += update.Update["w"][i] * weight
     aggregatedB += update.Update["b"] * weight
     ```
  4. Normalizes by total samples
  5. Increments model version
  6. Saves model to file: `/tmp/fl-models/global_model_v{N}.json`
  7. Publishes model to `fl/models/publish` (model server picks it up)
  8. Publishes round completion to `fl/rounds/{round_id}/complete`

**Code Location**: `coordinator/main.go:208-339`

##### Coordinator Aggregation Flow

```
Update Received (via fml/updates)
         │
         ▼
  ┌──────────────┐
  │ Round State  │
  │   Exists?    │
  └──┬────────┬──┘
     │        │
    Yes       No
     │        │
     │        ▼
     │  ┌──────────────┐
     │  │ Lazy Init    │
     │  │ Round        │
     │  │(k_of_n=3,    │
     │  │ timeout=30)  │
     │  └──────┬───────┘
     │         │
     └─────────┘
           │
           ▼
     ┌─────────────┐
     │ Add Update  │
     │ to List     │
     └──────┬──────┘
            │
            ▼
     ┌─────────────┐
     │ Lock Mutex  │
     │(Thread Safe)│
     └──────┬──────┘
            │
            ▼
     ┌─────────────┐
     │ Updates >=  │
     │   k_of_n?   │
     └──┬────────┬─┘
        │        │
       Yes      No
        │        │
        │        ▼
        │  ┌─────────────┐
        │  │ Wait for    │
        │  │ More        │
        │  └──────┬──────┘
        │         │
        │         ▼
        │  ┌─────────────┐
        │  │ Timeout?    │
        │  │ Check       │
        │  └──┬────────┬─┘
        │     │        │
        │   Yes       No
        │     │        │
        │     ▼        │
        │ ┌─────────┐  │
        │ │ Force   │  │
        │ │ Aggregate│ │
        │ └────┬────┘  │
        │      │       │
        └──────┴───────┘
               │
               ▼
        ┌─────────────┐
        │ Mark Round  │
        │ as Complete │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ Extract All │
        │ Updates     │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ Init Agg    │
        │ Model       │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ For Each    │
        │ Update:     │
        │ Weight =    │
        │ num_samples │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ Sum Weighted│
        │ Updates     │
        │ aggregated_w│
        │ += w*weight │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ More Updates│
        │    ?        │
        └──┬────────┬─┘
          Yes       No
           │        │
           │        ▼
           │  ┌─────────────┐
           │  │ Normalize   │
           │  │ by Total    │
           │  │ Samples     │
           │  └──────┬──────┘
           │         │
           └─────────┘
                 │
                 ▼
          ┌─────────────┐
          │ Increment   │
          │ Version     │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ Save Model  │
          │ to File     │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ Publish to  │
          │ fl/models/  │
          │ publish     │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ Publish     │
          │ Round       │
          │ Complete    │
          └──────┬──────┘
                 │
                 ▼
          ┌─────────────┐
          │ Model Server│
          │ Receives &  │
          │ Republishes │
          └──────┬──────┘
                 │
                 ▼
        Aggregation Complete
        Round Finished
```

#### `checkRoundTimeouts()`
- **Purpose**: Background goroutine that checks for round timeouts
- **Process**:
  1. Runs every 5 seconds
  2. For each incomplete round:
     - Calculates elapsed time
     - If `elapsed >= timeout_s`:
       - Marks round as completed
       - Triggers aggregation if updates exist

**Code Location**: `coordinator/main.go:341-364`

**State Management**:
- Round state stored in memory (`rounds` map)
- Thread-safe with `roundsMu` (RWMutex) for map access
- Per-round mutex (`round.mu`) for update list access
- Model version counter with mutex protection

### 3. Model Server

**Location**: `examples/fl-demo/model-server/main.go`

**Responsibilities**:
- Model storage and persistence
- Model distribution via MQTT (retained messages)
- Initial default model creation

**Key Functions**:

#### `handleModelPublish(_ mqtt.Client, msg mqtt.Message, client mqtt.Client, modelsDir string)`
- **Subscribes to**: `fl/models/publish`
- **Purpose**: Receives new models from coordinator and publishes them
- **Process**:
  1. Parses model JSON from coordinator
  2. Saves to file: `/tmp/fl-models/global_model_v{N}.json`
  3. Publishes to MQTT topic: `fl/models/global_model_v{N}` (retained message)
  4. Retained messages allow clients to get the model immediately when subscribing

**Code Location**: `model-server/main.go:99-129`

#### `watchAndPublishModels(client mqtt.Client, modelsDir string)`
- **Purpose**: Background goroutine that watches for new model files
- **Process**:
  1. Polls `/tmp/fl-models/` directory every 5 seconds
  2. Finds latest model version
  3. If new version detected, publishes to MQTT
  4. Uses retained messages for immediate availability

**Code Location**: `model-server/main.go:148-197`

**Initialization**:
- Creates default model `global_model_v0.json` if none exists:
  ```json
  {
    "w": [0.0, 0.0, 0.0],
    "b": 0.0,
    "version": 0
  }
  ```
- Publishes default model on startup

### 4. Proplet Service

The FL implementation differs between the Rust proplet and embedded proplet, each optimized for their respective execution environments.

#### 4.1 Rust Proplet FL Implementation

**Location**: `proplet/src/service.rs`

**Responsibilities**:
- WASM module execution using Wasmtime runtime
- Task result collection
- FL update publication (HTTP-first with MQTT fallback)

**Key Functions**:

##### FL Update Detection and Publishing
- **Detection**: Checks for `ROUND_ID` environment variable in task
- **Process**:
  1. After WASM execution completes, captures stdout
  2. Parses stdout as JSON (expected FL update format)
  3. If valid JSON and `ROUND_ID` present:
     - **Primary**: Attempts HTTP POST to coordinator: `{COORDINATOR_URL}/update`
     - **Fallback**: If HTTP fails, publishes to MQTT topic: `fl/rounds/{round_id}/updates/{proplet_id}`
  4. If JSON parsing fails, logs warning (unless task failed)

**HTTP-First Strategy**:
- Rust proplet uses HTTP POST for direct communication with coordinator
- Falls back to MQTT if HTTP fails (network issues, coordinator unavailable)
- Provides better performance and lower latency when coordinator is accessible
- MQTT fallback ensures reliability in distributed scenarios

**Code Location**: `proplet/src/service.rs:595-647`

**WASM Execution**:
- Uses Wasmtime runtime (external) or wazero (embedded)
- Executes `run()` function exported from WASM module
- Captures stdout as task result
- Sets environment variables from task spec including:
  - `ROUND_ID`: Round identifier
  - `MODEL_URI`: Model MQTT topic or HTTP URL
  - `COORDINATOR_URL`: HTTP coordinator endpoint
  - `HYPERPARAMS`: JSON-encoded hyperparameters

##### Rust Proplet FL Workflow

```
Task Start Command Received
         │
         ▼
  ┌──────────────┐
  │ Check ROUND_ID│
  │ Env Variable │
  └──────┬───────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
ROUND_ID   No ROUND_ID
Present         │
    │           ▼
    ▼    ┌─────────────┐
┌──────────┐   │ Normal Task │
│FL Task   │   │ Execute     │
│Detected  │   │ and Return  │
└────┬─────┘   └──────┬──────┘
     │                │
     ▼                │
┌───────────────┐     │
│ Execute WASM  │     │
│ Module        │     │
│(Wasmtime/     │     │
│ wazero)       │     │
└──────┬────────┘     │
       │              │
       ▼              │
┌───────────────┐     │
│Capture stdout │     │
│Parse as JSON  │     │
└──────┬────────┘     │
       │              │
       ▼              │
┌──────────────┐      │
│ Valid JSON?  │      │
└──┬─────────┬─┘      │
   │         │        │
  Yes       No        │
   │         │        │
   ▼         ▼        │
Extract    Log        │
round_id   Warning    │
   │         │        │
   ▼         │        │
┌─────────────┐       │
│ Try HTTP    │       │
│ POST to     │       │
│ Coordinator │       │
└──┬────────┬─┘       │
   │        │         │
Success  Failure      │
   │        │         │
   ▼        ▼         │
┌─────┐ ┌──────────┐  │
│HTTP │ │ Fallback │  │
│✓    │ │ Publish  │  │
└──┬──┘ │to MQTT   │  │
    │   └────┬─────┘  │
    │        │        │
    │        ▼        │
    │   ┌──────────┐  │
    │   │MQTT ✓    │  │
    │   └────┬─────┘  │
    └───────┴─────────┘
            │
            ▼
      Task Complete
```

#### 4.2 Embedded Proplet FL Implementation

**Location**: `embed-proplet/src/mqtt_client.c` and `embed-proplet/src/wasm_handler.c`

**Responsibilities**:
- WASM module execution using WAMR (WebAssembly Micro Runtime)
- FL task detection and data fetching
- Host function registration for WASM modules
- FL update publication via MQTT

**Key Functions**:

##### FL Task Detection and Workflow
- **Detection**: Checks for `ROUND_ID` environment variable in task start command
- **Process**:
  1. **Task Detection**: Proplet detects FL task via `ROUND_ID` environment variable
  2. **PROPLET_ID Setup**: Sets `PROPLET_ID` from `config.client_id` (Manager-known identity)
  3. **Model Fetching**: Fetches model from Model Registry via HTTP GET
     - URL: `{MODEL_REGISTRY_URL}/models/{version}`
     - Stores result in `g_current_task.model_data`
     - Falls back to MQTT subscription if HTTP fails
  4. **Dataset Fetching**: Fetches dataset from Local Data Store via HTTP GET
     - URL: `{DATA_STORE_URL}/datasets/{proplet_id}`
     - Stores result in `g_current_task.dataset_data`
  5. **WASM Execution**: Executes WASM module with host functions registered
  6. **Host Function Calls**: WASM module calls host functions to get:
     - `PROPLET_ID` via `get_proplet_id()`
     - `MODEL_DATA` via `get_model_data()`
     - `DATASET_DATA` via `get_dataset_data()`
  7. **Training**: WASM module performs local training and outputs JSON update to stdout
  8. **Update Submission**: Proplet captures stdout, parses JSON, and publishes to MQTT:
     - Topic: `fl/rounds/{round_id}/updates/{proplet_id}`
     - Message: JSON update with `round_id`, `proplet_id`, `update`, `metrics`, etc.

**Host Functions**:
The embedded proplet provides three host functions for WASM modules:

1. **`get_proplet_id(ret_offset *i32, ret_len *i32) -> i32`**
   - Returns PROPLET_ID as string in WASM linear memory
   - Used by WASM module to identify itself in FL updates

2. **`get_model_data(ret_offset *i32, ret_len *i32) -> i32`**
   - Returns MODEL_DATA JSON string in WASM linear memory
   - Contains global model weights fetched from Model Registry

3. **`get_dataset_data(ret_offset *i32, ret_len *i32) -> i32`**
   - Returns DATASET_DATA JSON string in WASM linear memory
   - Contains local dataset fetched from Data Store

**Environment Variable Fallback**:
For compatibility with TinyGo/WASI, the embedded proplet also sets these as environment variables:
- `PROPLET_ID`: Set from `config.client_id`
- `MODEL_DATA`: Set from fetched model JSON
- `DATASET_DATA`: Set from fetched dataset JSON

**Code Locations**:
- FL task detection: `embed-proplet/src/mqtt_client.c:535-771`
- Model/dataset fetching: `embed-proplet/src/mqtt_client.c:801-893`
- Update publication: `embed-proplet/src/mqtt_client.c:1301-1403`
- Host function registration: `embed-proplet/src/wasm_handler.c`

**WASM Execution**:
- Uses WAMR runtime (compiled into Zephyr firmware)
- Supports both interpreter mode and AOT compilation
- Executes exported `run()` function from WASM module
- Captures stdout for update extraction
- Memory-constrained environment (40 KB heap pool)

##### Embedded Proplet FL Workflow

```
Task Start Command Received (via MQTT)
         │
         ▼
  ┌──────────────┐
  │ Check ROUND_ID│
  │ Env Variable │
  └──────┬───────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
ROUND_ID   No ROUND_ID
Present         │
    │           ▼
    ▼      ┌──────────────┐
┌──────────┐   │ Normal Task │
│FL Task   │   │ Execute     │
│Detected  │   │ WASM Only   │
└────┬─────┘   └──────┬──────┘
     │                │
     ▼                │
┌──────────────┐      │
│ Set PROPLET_ID│     │
│from config   │      │
└──────┬───────┘      │
       │              │
       ▼              │
┌──────────────┐      │
│ Fetch Model  │      │
│from Registry │      │
│HTTP GET      │      │
└──┬─────────┬─┘      │
   │         │        │
Success  Failure      │
   │         │        │
   ▼         ▼        │
Store     MQTT        │
Model     Fallback    │
   │         │        │
   └────┬────┘        │
        │             │
        ▼             │
┌──────────────┐      │
│Fetch Dataset │      │
│from Data Store│     │
│HTTP GET      │      │
└──┬─────────┬─┘      │
   │         │        │
Success  Failure      │
   │         │        │
   ▼         ▼        │
Store     Synthetic   │
Dataset   Data        │
   │         │        │
   └────┬────┘        │
        │             │
        ▼             │
┌─────────────────┐   │
│ Register Host   │   │
│ Functions:      │   │
│ - get_proplet_id│   │
│ - get_model_data│   │
│ - get_dataset_  │   │
│   data          │   │
└──────┬──────────┘   │
       │              │
       ▼              │
┌──────────────┐      │
│ Execute WASM │      │
│ Module (WAMR)│      │
└──────┬───────┘      │
       │              │
       ▼              │
┌──────────────┐      │
│ WASM Calls   │      │
│ Host Functions│     │
└──────┬───────┘      │
       │              │
       ▼              │
┌──────────────┐      │
│Local Training│      │
│Generate Update│     │
└──────┬───────┘      │
       │              │
       ▼              │
┌──────────────┐      │
│ Output JSON  │      │
│ Update       │      │
│to stdout     │      │
└──────┬───────┘      │
       │              │
       ▼              │
┌──────────────┐      │
│ Capture      │      │
│ Parse JSON   │      │
└──┬─────────┬─┘      │
   │         │        │
  Yes       No        │
   │         │        │
   ▼         ▼        │
Publish    Log        │
to MQTT    Error      │
   │         │        │
   ▼         │        │
┌──────────┐ │        │
│MQTT ✓    │ │        │
└────┬─────┘ │        │
     └───────┴────────┘
            │
            ▼
      Task Complete
```

##### Differences from Rust Proplet

| Feature | Rust Proplet | Embedded Proplet |
|---------|--------------|------------------|
| **Update Submission** | HTTP POST (primary), MQTT (fallback) | MQTT only |
| **Data Access** | Environment variables | Host functions + env vars |
| **Model Fetching** | WASM handles via MQTT/HTTP | Proplet fetches before execution |
| **Dataset Fetching** | WASM handles | Proplet fetches before execution |
| **Runtime** | Wasmtime (external) or wazero | WAMR (embedded in Zephyr) |
| **Memory Constraints** | Host system resources | 40 KB heap pool |

### 5. Client WASM Module

**Location**: `examples/fl-demo/client-wasm/fl-client.go`

**Purpose**: Sample FL training workload that runs on each proplet

**Implementation Details**:

#### Environment Variables
- `ROUND_ID`: Current round identifier
- `MODEL_URI`: MQTT topic for base model (e.g., `fl/models/global_model_v0`)
- `HYPERPARAMS`: JSON string with training hyperparameters

#### Training Process
1. **Model Initialization**:
   - Default model: `{"w": [0.0, 0.0, 0.0], "b": 0.0}`
   - In production, would subscribe to `MODEL_URI` MQTT topic to fetch model

2. **Local Training**:
   - Simulates training with random gradient updates
   - Applies learning rate: `weights[i] += lr * gradient`
   - Runs for specified number of epochs

3. **Update Generation**:
   - Creates update JSON:
     ```json
     {
       "round_id": "r-...",
       "base_model_uri": "fl/models/global_model_v0",
       "num_samples": 512,
       "metrics": {"loss": 0.73},
       "update": {
         "w": [0.12, -0.05, 1.01],
         "b": 0.33
       }
     }
     ```
   - Outputs to stdout (captured by proplet)

**Code Location**: `client-wasm/fl-client.go:24-113`

**Build Command**:
```bash
cd client-wasm
GOOS=wasip1 GOARCH=wasm go build -o fl-client.wasm fl-client.go
```

---

## Message Flow and MQTT Topics

### Topic Structure

| Topic | Publisher | Subscriber | Purpose |
|-------|-----------|------------|---------|
| `fl/rounds/start` | External trigger / Test script | Manager, Coordinator | Round start message |
| `fl/rounds/{round_id}/updates/{proplet_id}` | Proplet | Manager | FL update from proplet |
| `fml/updates` | Manager | Coordinator | Forwarded updates for aggregation |
| `fl/models/publish` | Coordinator | Model Server | New aggregated model |
| `fl/models/global_model_v{N}` | Model Server | Clients (future) | Published model (retained) |
| `fl/rounds/{round_id}/complete` | Coordinator | External (future) | Round completion notification |

### Complete Message Flow

```
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
   │ Model Server │ (saves and republishes)
   └────┬──────────┘
        │
        │ Publishes to: fl/models/global_model_v{N}
        │ (retained message)
```

### Message Formats

#### Round Start Message
```json
{
  "round_id": "r-1768464194",
  "model_uri": "fl/models/global_model_v0",
  "task_wasm_image": "oci://example/fl-client-wasm:latest",
  "participants": ["proplet-1", "proplet-2", "proplet-3"],
  "hyperparams": {
    "epochs": 1,
    "lr": 0.01,
    "batch_size": 16
  },
  "k_of_n": 3,
  "timeout_s": 30
}
```

#### FL Update Message (from Proplet)
```json
{
  "round_id": "r-1768464194",
  "base_model_uri": "fl/models/global_model_v0",
  "num_samples": 512,
  "metrics": {
    "loss": 0.73
  },
  "update": {
    "w": [0.12, -0.05, 1.01],
    "b": 0.33
  }
}
```

#### Aggregated Model
```json
{
  "w": [0.08, -0.02, 0.95],
  "b": 0.25,
  "version": 1
}
```

#### Round Completion Message
```json
{
  "round_id": "r-1768464194",
  "model_version": 1,
  "model_topic": "fl/models/global_model_v1",
  "num_updates": 3,
  "total_samples": 1536,
  "completed_at": "2026-01-12T10:30:45Z"
}
```

---

## Implementation Details

### Thread Safety

**Coordinator**:
- `roundsMu` (RWMutex): Protects `rounds` map
- `round.mu` (Mutex): Protects individual round's update list
- `modelMu` (Mutex): Protects model version counter

**Manager**:
- Stateless forwarding (no shared state)
- Goroutines for async message handling

### Error Handling

**Coordinator**:
- Lazy round initialization if update received before round start
- Timeout handling for incomplete rounds
- JSON parsing errors logged and ignored

**Proplet**:
- WASM execution errors published as task results
- JSON parsing failures logged (non-fatal for non-FL tasks)

### Persistence

**Current Implementation**:
- Round state: In-memory only (lost on restart)
- Models: Persisted to `/tmp/fl-models/` (Docker volume)
- Model versions: Incremented counter (persists across restarts if coordinator restarts)

**Future Enhancements**:
- Database-backed round state
- Model version history
- Round completion logs

### Scalability Considerations

**Current Limitations**:
- Single coordinator instance (no horizontal scaling)
- In-memory round state (limited by RAM)
- No distributed locking for coordinator

**Design for Future**:
- Coordinator can be made stateless with external storage
- Multiple coordinators with consistent hashing
- Distributed locking for aggregation

---

## Testing Guide

This section covers testing FML with both Rust proplet and embedded proplet implementations.

### Prerequisites

#### For Rust Proplet FL Demo

1. **Docker and Docker Compose** installed
2. **Go 1.21+** (for building WASM client)
3. **Python 3** with `requests` library
4. All services on `fl-demo-http` Docker network

#### For Embedded Proplet FL Demo

1. **TinyGo** installed (for WASM compilation targeting WAMR)
2. **Go 1.21+**
3. **Zephyr RTOS** development environment (for building embedded proplet)
4. **ESP32-S3** development board or QEMU emulator

## Rust Proplet FL Demo

This section demonstrates running FML with Rust proplets using the HTTP-based coordinator.

### Step 1: Build WASM Client

```bash
cd /home/jeff-mboya/Documents/propeller/examples/fl-demo/client-wasm
GOOS=wasip1 GOARCH=wasm go build -o fl-client.wasm fl-client.go
cd ..
```

**Expected Output**:
```
# No errors, fl-client.wasm file created
```

**Verification**:
```bash
ls -lh client-wasm/fl-client.wasm
# Should show file size ~4-5 MB
```

### Step 2: Configure MQTT Broker (Optional)

To prevent connection drops, update MQTT configuration:

```bash
cat > mqtt/mosquitto.conf << 'EOF'
listener 1883
allow_anonymous true

persistence true
persistence_location /mosquitto/data/

keepalive_interval 60
max_connections -1

max_inflight_messages 100
max_queued_messages 1000

connection_messages true
retry_interval 20

listener 9001
protocol websockets
allow_anonymous true
EOF
```

### Step 3: Start All Services

```bash
cd /home/jeff-mboya/Documents/propeller/examples/fl-demo
docker compose -f compose-http.yaml up -d
```

**Expected Output**:
```
[+] Running 8/8
 ✔ Container fl-demo-mqtt-1         Started
 ✔ Container fl-demo-manager-1      Started
 ✔ Container fl-demo-model-server-1 Started
 ✔ Container fl-demo-coordinator-1  Started
 ✔ Container fl-demo-proplet-1-1    Started
 ✔ Container fl-demo-proplet-2-1    Started
 ✔ Container fl-demo-proplet-3-1    Started
```

**Verification**:
```bash
docker compose ps
# All services should show "Up" status
```

### Step 4: Verify Services Are Running

**Check Manager Health**:
```bash
curl http://localhost:7070/health
```

**Expected Response**:
```json
{
  "status": "pass",
  "version": "v0.3.0",
  "commit": "22541f09d2d2fdda32f94b0322b0f4b96b276e92",
  "description": "manager service",
  "build_time": "2026-01-12T05:58:08Z",
  "instance_id": "7b14279e-b01f-4108-b257-2ecb86b76576"
}
```

**Check Service Logs**:
```bash
# Coordinator (should show MQTT connection)
docker compose logs coordinator | tail -10

# Manager (should show HTTP server listening)
docker compose logs manager | tail -10

# Proplet (should show MQTT connection)
docker compose logs proplet-1 | tail -10
```

**Expected Logs**:
- Coordinator: `FML Coordinator connected to MQTT broker`
- Manager: `manager service http server listening at localhost:7070`
- Proplet: MQTT connection messages (may have initial connection attempts)

### Step 5: Install Python Dependencies

```bash
pip3 install requests
```

Or with virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
pip install requests
```

### Step 6: Run the Federated Learning Test

```bash
cd /home/jeff-mboya/Documents/propeller/examples/fl-demo
python3 test-fl-local.py
```

**Expected Output**:
```
Reading WASM file: client-wasm/fl-client.wasm
WASM file encoded: 4279132 characters

Creating tasks for round: r-1768464194
Participants: ['proplet-1', 'proplet-2', 'proplet-3']

Creating task for proplet-1...
  Task created: <task-id-1>
  Starting task...
  Task started successfully

Creating task for proplet-2...
  Task created: <task-id-2>
  Starting task...
  Task started successfully

Creating task for proplet-3...
  Task created: <task-id-3>
  Starting task...
  Task started successfully

✅ Successfully launched 3 tasks

Monitor progress:
  docker compose logs -f coordinator
  docker compose logs -f manager
  docker compose logs -f proplet-1

Check aggregated models:
  docker compose exec model-server ls -la /tmp/fl-models/
```

### Step 7: Monitor Federated Learning Progress

#### Watch Coordinator (Aggregation)

```bash
docker compose logs -f coordinator
```

**What to Look For**:

1. **Round Initialization** (if round start message received):
   ```
   INFO Initialized round state round_id=r-1768464194 k_of_n=3 timeout_s=60
   ```

2. **Update Reception**:
   ```
   INFO Received update round_id=r-1768464194 proplet_id=proplet-1 total_updates=1 k_of_n=3
   INFO Received update round_id=r-1768464194 proplet_id=proplet-2 total_updates=2 k_of_n=3
   INFO Received update round_id=r-1768464194 proplet_id=proplet-3 total_updates=3 k_of_n=3
   ```

3. **Aggregation Trigger**:
   ```
   INFO Round complete: received k_of_n updates round_id=r-1768464194 updates=3
   INFO Aggregating updates round_id=r-1768464194 num_updates=3
   ```

4. **Model Saving**:
   ```
   INFO Aggregated model saved round_id=r-1768464194 version=1 file=/tmp/fl-models/global_model_v1.json
   ```

5. **Model Publication**:
   ```
   INFO Published model to model server version=1
   INFO Published round completion round_id=r-1768464194 topic=fl/rounds/r-1768464194/complete
   ```

**Sample Complete Coordinator Log**:
```
2026-01-12T10:30:00Z INFO FML Coordinator connected to MQTT broker
2026-01-12T10:30:00Z INFO Subscribed to fml/updates
2026-01-12T10:30:00Z INFO Subscribed to fl/rounds/start
2026-01-12T10:30:15Z INFO Received update for unknown round, lazy initializing round_id=r-1768464194
2026-01-12T10:30:15Z INFO Received update round_id=r-1768464194 proplet_id=proplet-1 total_updates=1 k_of_n=3
2026-01-12T10:30:16Z INFO Received update round_id=r-1768464194 proplet_id=proplet-2 total_updates=2 k_of_n=3
2026-01-12T10:30:17Z INFO Received update round_id=r-1768464194 proplet_id=proplet-3 total_updates=3 k_of_n=3
2026-01-12T10:30:17Z INFO Round complete: received k_of_n updates round_id=r-1768464194 updates=3
2026-01-12T10:30:17Z INFO Aggregating updates round_id=r-1768464194 num_updates=3
2026-01-12T10:30:17Z INFO Aggregated model saved round_id=r-1768464194 version=1 file=/tmp/fl-models/global_model_v1.json
2026-01-12T10:30:17Z INFO Published model to model server version=1
2026-01-12T10:30:17Z INFO Published round completion round_id=r-1768464194 topic=fl/rounds/r-1768464194/complete
```

#### Watch Manager (Orchestration)

```bash
docker compose logs -f manager
```

**What to Look For**:

1. **Task Creation**:
   ```
   INFO launched task for FL round participant round_id=r-1768464194 proplet_id=proplet-1 task_id=<task-id>
   ```

2. **Update Forwarding**:
   ```
   INFO forwarded FL update to coordinator round_id=r-1768464194 proplet_id=proplet-1
   ```

**Sample Manager Log**:
```
2026-01-12T10:30:10Z INFO launched task for FL round participant round_id=r-1768464194 proplet_id=proplet-1 task_id=abc123
2026-01-12T10:30:11Z INFO launched task for FL round participant round_id=r-1768464194 proplet_id=proplet-2 task_id=def456
2026-01-12T10:30:12Z INFO launched task for FL round participant round_id=r-1768464194 proplet_id=proplet-3 task_id=ghi789
2026-01-12T10:30:15Z INFO forwarded FL update to coordinator round_id=r-1768464194 proplet_id=proplet-1
2026-01-12T10:30:16Z INFO forwarded FL update to coordinator round_id=r-1768464194 proplet_id=proplet-2
2026-01-12T10:30:17Z INFO forwarded FL update to coordinator round_id=r-1768464194 proplet_id=proplet-3
```

#### Watch Proplet (Training Execution)

```bash
docker compose logs -f proplet-1
```

**What to Look For**:

1. **Task Start**:
   ```
   INFO Received start command for task <task-id>
   ```

2. **WASM Execution**:
   ```
   INFO Executing WASM module for task <task-id>
   ```

3. **FL Update Publication**:
   ```
   INFO Detected FL task via ROUND_ID env. Publishing update to coordinator topic: fl/rounds/r-1768464194/updates/proplet-1
   INFO Successfully published FL update to coordinator: fl/rounds/r-1768464194/updates/proplet-1
   ```

**Sample Proplet Log**:
```
2026-01-12T10:30:10Z INFO MQTT client connected successfully
2026-01-12T10:30:13Z INFO Received start command for task abc123
2026-01-12T10:30:13Z INFO Executing WASM module for task abc123
2026-01-12T10:30:15Z INFO Detected FL task via ROUND_ID env. Publishing update to coordinator topic: fl/rounds/r-1768464194/updates/proplet-1
2026-01-12T10:30:15Z INFO Successfully published FL update to coordinator: fl/rounds/r-1768464194/updates/proplet-1
2026-01-12T10:30:15Z INFO Publishing result for task abc123
```

#### Watch All Services Together

```bash
docker compose logs -f
```

Press `Ctrl+C` to stop watching.

### Step 8: Verify Results

#### Check Aggregated Models

```bash
docker compose exec model-server ls -la /tmp/fl-models/
```

**Expected Output**:
```
total 16
drwxr-xr-x 2 root root 4096 Jan 12 10:30 .
drwxr-xr-x 1 root root 4096 Jan 12 10:30 ..
-rw-r--r-- 1 root root  123 Jan 12 10:30 global_model_v0.json
-rw-r--r-- 1 root root  125 Jan 12 10:30 global_model_v1.json
```

#### View Model Contents

```bash
docker compose exec model-server cat /tmp/fl-models/global_model_v0.json
```

**Expected Output** (Default Model):
```json
{
  "w": [0.0, 0.0, 0.0],
  "b": 0.0,
  "version": 0
}
```

```bash
docker compose exec model-server cat /tmp/fl-models/global_model_v1.json
```

**Expected Output** (Aggregated Model):
```json
{
  "w": [0.008234, -0.001567, 0.012345],
  "b": 0.002341,
  "version": 1
}
```

**Note**: Actual values will vary due to random training updates in the demo.

#### Check Task Status via Manager API

```bash
curl http://localhost:7070/tasks
```

**Expected Response**:
```json
{
  "offset": 0,
  "limit": 100,
  "total": 3,
  "tasks": [
    {
      "id": "abc123",
      "name": "fl-round-r-1768464194-proplet-1",
      "state": "Completed",
      "proplet_id": "proplet-1",
      "created_at": "2026-01-12T10:30:10Z",
      ...
    },
    {
      "id": "def456",
      "name": "fl-round-r-1768464194-proplet-2",
      "state": "Completed",
      "proplet_id": "proplet-2",
      ...
    },
    {
      "id": "ghi789",
      "name": "fl-round-r-1768464194-proplet-3",
      "state": "Completed",
      "proplet_id": "proplet-3",
      ...
    }
  ]
}
```

### Step 9: Testing Multiple Rounds

To test multiple FL rounds, simply run the test script again:

```bash
python3 test-fl-local.py
```

Each run creates a new round with a unique round ID (timestamp-based).

**Expected Behavior**:
- New round ID generated (e.g., `r-1768464195`)
- New tasks created for each proplet
- New aggregated model version (e.g., `global_model_v2`)
- Previous round state preserved in coordinator (until restart)

---

## Expected Results

### Successful Round Execution

**Timeline** (approximate):
- **T+0s**: Test script creates tasks
- **T+1-3s**: Manager launches tasks, proplets start WASM execution
- **T+3-5s**: Proplets complete training, publish updates
- **T+5-6s**: Coordinator receives all updates, aggregates
- **T+6-7s**: New model saved and published

**Expected Outcomes**:

1. **All Tasks Complete**:
   - 3 tasks created (one per proplet)
   - All tasks reach "Completed" state
   - No task failures

2. **Updates Received**:
   - Coordinator receives 3 updates (one per proplet)
   - All updates have valid JSON structure
   - Updates contain `round_id`, `proplet_id`, `num_samples`, `update` fields

3. **Aggregation Successful**:
   - Coordinator aggregates when 3 updates received (k_of_n=3)
   - New model version created (incremented from previous)
   - Model file saved to `/tmp/fl-models/global_model_v{N}.json`

4. **Model Published**:
   - Model server receives model from coordinator
   - Model published to MQTT topic `fl/models/global_model_v{N}`
   - Model available as retained message

5. **Round Completion**:
   - Completion message published to `fl/rounds/{round_id}/complete`
   - Round marked as completed in coordinator

### Sample Model Evolution

**Round 1** (Starting from default model):
- Input: `global_model_v0.json` with `w: [0.0, 0.0, 0.0]`, `b: 0.0`
- Updates from 3 proplets with random training
- Output: `global_model_v1.json` with aggregated weights (e.g., `w: [0.008, -0.002, 0.012]`)

**Round 2** (Starting from round 1 model):
- Input: `global_model_v1.json`
- Updates from 3 proplets
- Output: `global_model_v2.json` with further aggregated weights

**Pattern**: Each round refines the model based on distributed training.

### Expected Log Patterns

**Coordinator**:
```
INFO Received update round_id=r-... proplet_id=proplet-1 total_updates=1 k_of_n=3
INFO Received update round_id=r-... proplet_id=proplet-2 total_updates=2 k_of_n=3
INFO Received update round_id=r-... proplet_id=proplet-3 total_updates=3 k_of_n=3
INFO Round complete: received k_of_n updates
INFO Aggregating updates round_id=r-... num_updates=3
INFO Aggregated model saved round_id=r-... version=1
INFO Published model to model server version=1
INFO Published round completion round_id=r-...
```

**Manager**:
```
INFO launched task for FL round participant round_id=r-... proplet_id=proplet-1
INFO launched task for FL round participant round_id=r-... proplet_id=proplet-2
INFO launched task for FL round participant round_id=r-... proplet_id=proplet-3
INFO forwarded FL update to coordinator round_id=r-... proplet_id=proplet-1
INFO forwarded FL update to coordinator round_id=r-... proplet_id=proplet-2
INFO forwarded FL update to coordinator round_id=r-... proplet_id=proplet-3
```

**Proplet**:
```
INFO Received start command for task <task-id>
INFO Executing WASM module for task <task-id>
INFO Detected FL task via ROUND_ID env. Publishing update to coordinator topic: fl/rounds/r-.../updates/proplet-1
INFO Successfully published FL update to coordinator: fl/rounds/r-.../updates/proplet-1
```

### Expected File Structure

```
/tmp/fl-models/
├── global_model_v0.json  (default, created on model-server startup)
├── global_model_v1.json  (after round 1)
├── global_model_v2.json  (after round 2)
└── ...
```

### Expected MQTT Topics and Messages

**Topic**: `fl/rounds/{round_id}/updates/{proplet_id}`
- **Publisher**: Proplet
- **Message**: FL update JSON
- **Frequency**: Once per proplet per round

**Topic**: `fml/updates`
- **Publisher**: Manager (forwarding)
- **Message**: FL update JSON with `forwarded_at` timestamp
- **Frequency**: Once per proplet per round

**Topic**: `fl/models/publish`
- **Publisher**: Coordinator
- **Message**: Aggregated model JSON
- **Frequency**: Once per completed round

**Topic**: `fl/models/global_model_v{N}`
- **Publisher**: Model Server
- **Message**: Aggregated model JSON (retained)
- **Frequency**: Once per completed round

**Topic**: `fl/rounds/{round_id}/complete`
- **Publisher**: Coordinator
- **Message**: Round completion JSON
- **Frequency**: Once per completed round

---

## Troubleshooting

### Issue: Manager Not Accessible on Port 7070

**Symptoms**:
- `curl http://localhost:7070/health` returns connection refused
- Test script fails with connection error

**Solution**:
1. Check if port is exposed in `compose.yaml`:
   ```bash
   grep -A 5 "manager:" compose.yaml | grep "ports"
   ```
   Should show: `- "7070:7070"`

2. Restart manager:
   ```bash
   docker compose restart manager
   ```

3. Wait a few seconds and verify:
   ```bash
   sleep 5
   curl http://localhost:7070/health
   ```

4. Check manager logs:
   ```bash
   docker compose logs manager | grep listening
   ```
   Should show: `manager service http server listening at localhost:7070`

### Issue: Proplets Showing "Unhealthy"

**Symptoms**:
- `docker compose ps` shows proplets as unhealthy
- Tasks not starting on proplets

**Solution**:
1. Healthcheck is disabled in compose file, so this shouldn't occur
2. If it does, restart proplets:
   ```bash
   docker compose restart proplet-1 proplet-2 proplet-3
   ```

3. Check logs for actual errors:
   ```bash
   docker compose logs proplet-1 | tail -20
   ```

### Issue: MQTT Connection Errors

**Symptoms**:
- Coordinator logs show MQTT connection failures
- Proplets can't connect to MQTT broker
- Updates not being received

**Solution**:
1. Verify MQTT broker is running:
   ```bash
   docker compose ps mqtt
   ```
   Should show "Up" status

2. Check MQTT logs:
   ```bash
   docker compose logs mqtt | tail -20
   ```

3. Verify network connectivity:
   ```bash
   docker compose exec proplet-1 getent hosts mqtt
   ```
   Should return: `172.x.x.x mqtt`

4. Restart MQTT broker:
   ```bash
   docker compose restart mqtt
   ```

### Issue: "Connection Refused" When Running Test Script

**Symptoms**:
- Test script fails immediately with connection error
- Manager health endpoint not responding

**Solution**:
1. Wait for manager to fully start (may take 10-15 seconds after `docker compose up`)
2. Verify manager is running:
   ```bash
   docker compose ps manager
   ```
3. Check manager logs:
   ```bash
   docker compose logs manager | grep -i "listening\|error"
   ```
4. Try health endpoint:
   ```bash
   curl http://localhost:7070/health
   ```
5. If still failing, restart manager:
   ```bash
   docker compose restart manager
   sleep 10
   curl http://localhost:7070/health
   ```

### Issue: Tasks Not Starting

**Symptoms**:
- Test script creates tasks but they don't start
- No proplet execution logs

**Solution**:
1. Check if proplets are alive:
   ```bash
   curl http://localhost:7070/proplets
   ```
   Should return list of proplets with `"alive": true`

2. Verify proplets are connected to MQTT:
   ```bash
   docker compose logs proplet-1 | grep -i "connected\|mqtt"
   ```
   Should show connection success messages

3. Check manager logs for errors:
   ```bash
   docker compose logs manager | grep -i error
   ```

4. Verify task creation:
   ```bash
   curl http://localhost:7070/tasks
   ```
   Check if tasks exist and their state

### Issue: No Updates Received by Coordinator

**Symptoms**:
- Proplets publish updates but coordinator doesn't receive them
- Coordinator logs show no update messages

**Solution**:
1. Verify coordinator is subscribed:
   ```bash
   docker compose logs coordinator | grep -i "subscribed"
   ```
   Should show: `Subscribed to fml/updates`

2. Check if proplets are publishing updates:
   ```bash
   docker compose logs proplet-1 | grep -i "update\|fl"
   ```
   Should show: `Successfully published FL update to coordinator`

3. Verify manager is forwarding:
   ```bash
   docker compose logs manager | grep -i "forwarded"
   ```
   Should show: `forwarded FL update to coordinator`

4. Check MQTT topic structure:
   - Proplet publishes to: `fl/rounds/{round_id}/updates/{proplet_id}`
   - Manager forwards to: `fml/updates`
   - Coordinator subscribes to: `fml/updates`

5. Verify MQTT broker is routing messages:
   ```bash
   docker compose logs mqtt | tail -20
   ```

### Issue: Aggregation Not Triggering

**Symptoms**:
- Updates received but aggregation doesn't happen
- No new model version created

**Solution**:
1. Check if `k_of_n` threshold is met:
   ```bash
   docker compose logs coordinator | grep -i "total_updates\|k_of_n"
   ```
   Should show: `total_updates=3 k_of_n=3` (or matching values)

2. Verify round state:
   - Coordinator logs should show round initialization
   - Check if round is marked as completed prematurely

3. Check for timeout:
   - If updates arrive slowly, timeout may trigger aggregation
   - Check timeout logs: `Round timeout exceeded`

4. Verify update format:
   - Updates must have valid JSON structure
   - Must include `round_id`, `proplet_id`, `update` fields

### Issue: Model Not Saved

**Symptoms**:
- Aggregation completes but no model file created
- Model server doesn't receive model

**Solution**:
1. Check coordinator logs for save errors:
   ```bash
   docker compose logs coordinator | grep -i "save\|error"
   ```

2. Verify models directory exists:
   ```bash
   docker compose exec model-server ls -la /tmp/fl-models/
   ```

3. Check file permissions:
   ```bash
   docker compose exec model-server ls -ld /tmp/fl-models/
   ```

4. Verify coordinator has write access:
   - Models directory is shared via Docker volume
   - Both coordinator and model-server should have access

### Issue: WASM Execution Fails

**Symptoms**:
- Proplet logs show WASM execution errors
- Tasks fail with WASM-related errors

**Solution**:
1. Verify WASM file is built correctly:
   ```bash
   file client-wasm/fl-client.wasm
   ```
   Should show: `WebAssembly (wasm) binary module`

2. Check WASM file size:
   ```bash
   ls -lh client-wasm/fl-client.wasm
   ```
   Should be ~4-5 MB

3. Rebuild WASM if needed:
   ```bash
   cd client-wasm
   GOOS=wasip1 GOARCH=wasm go build -o fl-client.wasm fl-client.go
   ```

4. Check proplet logs for specific error:
   ```bash
   docker compose logs proplet-1 | grep -i "wasm\|error"
   ```

5. Verify proplet has Wasmtime installed:
   ```bash
   docker compose exec proplet-1 wasmtime --version
   ```

---

## Advanced Testing

### Manual Round Start via MQTT

You can trigger rounds manually via MQTT (requires OCI registry for WASM):

```bash
mosquitto_pub -h localhost -t "fl/rounds/start" -m '{
  "round_id": "r-manual-001",
  "model_uri": "fl/models/global_model_v0",
  "task_wasm_image": "oci://example/fl-client-wasm:latest",
  "participants": ["proplet-1", "proplet-2", "proplet-3"],
  "hyperparams": {"epochs": 1, "lr": 0.01, "batch_size": 16},
  "k_of_n": 3,
  "timeout_s": 30
}'
```

### Monitoring MQTT Messages

Subscribe to MQTT topics to monitor messages:

```bash
# Monitor all FL topics
mosquitto_sub -h localhost -t "fl/#" -v

# Monitor coordinator updates
mosquitto_sub -h localhost -t "fml/updates" -v

# Monitor round completions
mosquitto_sub -h localhost -t "fl/rounds/+/complete" -v
```

### Testing with Different Hyperparameters

Modify `test-fl-local.py` to test different hyperparameters:

```python
hyperparams = {
    "epochs": 5,        # More epochs
    "lr": 0.001,        # Lower learning rate
    "batch_size": 32    # Larger batch size
}
```

### Testing with Different k_of_n Values

Modify test script to require fewer updates:

```python
# In round start message (if using MQTT directly)
"k_of_n": 2  # Aggregate with 2 updates instead of 3
```

**Note**: Coordinator defaults to `k_of_n=3` if not specified.

---

## Embedded Proplet FL Demo

This section demonstrates running FML with embedded proplets using WAMR runtime on Zephyr-based devices (e.g., ESP32-S3).

### Overview

The embedded proplet FL demo uses:
- **WAMR Runtime**: WebAssembly Micro Runtime compiled into Zephyr firmware
- **Host Functions**: Three host functions (`get_proplet_id`, `get_model_data`, `get_dataset_data`) for WASM modules
- **MQTT-Based Updates**: Updates published directly to MQTT (no HTTP fallback)
- **TinyGo Compilation**: WASM modules built with TinyGo targeting WAMR/WASI

### Step 1: Build Embedded FL Client WASM

```bash
cd /home/jeff-mboya/Documents/propeller/examples/fl-embedded

# Build WASM module using TinyGo (targeting WAMR/WASI)
tinygo build -target=wasi -o fl-client.wasm fl-client.go
```

**Expected Output**:
```
# No errors, fl-client.wasm file created
```

**Verification**:
```bash
ls -lh fl-client.wasm
# Should show file size ~100-200 KB (TinyGo produces smaller binaries than standard Go)
```

### Step 2: Base64 Encode WASM Module

The Manager requires base64-encoded WASM modules when creating tasks:

```bash
# Encode the WASM file
base64 -i fl-client.wasm -o fl-client.wasm.b64

# Or on macOS
base64 -i fl-client.wasm > fl-client.wasm.b64

# View encoded length (should be reasonable for MQTT transmission)
wc -c fl-client.wasm.b64
```

### Step 3: Prepare Task Configuration

Create a task JSON with FL-specific environment variables:

```json
{
  "id": "fl-task-embedded-1",
  "name": "fl-client-embedded",
  "file": "<base64-encoded-wasm-from-step-2>",
  "env": {
    "ROUND_ID": "round-1",
    "MODEL_URI": "fl/models/global_model_v0",
    "COORDINATOR_URL": "http://coordinator-http:8080",
    "MODEL_REGISTRY_URL": "http://model-registry:8081",
    "DATA_STORE_URL": "http://local-data-store:8083",
    "HYPERPARAMS": "{\"epochs\":1,\"lr\":0.01,\"batch_size\":16}"
  },
  "proplet_id": "embedded-proplet-1"
}
```

### Step 4: Start FL Infrastructure Services

Ensure the FL infrastructure is running (same as Rust proplet demo):

```bash
cd /home/jeff-mboya/Documents/propeller/examples/fl-demo
docker compose -f compose-http.yaml up -d
```

Required services:
- MQTT broker
- Manager
- Coordinator (HTTP)
- Model Registry
- Local Data Store

### Step 5: Create Task via Manager API

```bash
# Replace <base64-wasm> with the content of fl-client.wasm.b64
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d @task-config.json
```

Or create task programmatically using Python:

```python
import json
import base64
import requests

MANAGER_URL = "http://localhost:7070"

# Read and encode WASM file
with open("fl-client.wasm", "rb") as f:
    wasm_b64 = base64.b64encode(f.read()).decode('utf-8')

task_data = {
    "id": "fl-task-embedded-1",
    "name": "fl-client-embedded",
    "file": wasm_b64,
    "env": {
        "ROUND_ID": "round-1",
        "MODEL_URI": "fl/models/global_model_v0",
        "COORDINATOR_URL": "http://coordinator-http:8080",
        "MODEL_REGISTRY_URL": "http://model-registry:8081",
        "DATA_STORE_URL": "http://local-data-store:8083",
        "HYPERPARAMS": json.dumps({"epochs": 1, "lr": 0.01, "batch_size": 16})
    }
}

response = requests.post(f"{MANAGER_URL}/tasks", json=task_data)
print(response.json())
```

### Step 6: Start Task on Embedded Proplet

```bash
curl -X POST http://localhost:7070/tasks/fl-task-embedded-1/start
```

### Step 7: Monitor Embedded Proplet Execution

#### Embedded Proplet Logs

The embedded proplet will log:

```
[INFO] FML task detected: ROUND_ID=round-1
[INFO] Fetching model from registry: http://model-registry:8081/models/0
[INFO] Successfully fetched model v0 via HTTP and stored in MODEL_DATA
[INFO] Fetching dataset for proplet_id=embedded-proplet-1 from: http://local-data-store:8083/datasets/embedded-proplet-1
[INFO] Successfully fetched dataset via HTTP and stored in DATASET_DATA
[INFO] WASM execution started
[INFO] WASM module completed, capturing stdout
[INFO] Publishing FML update to fl/rounds/round-1/updates/embedded-proplet-1
[INFO] Successfully published FL update to MQTT
```

#### Monitor MQTT Topics

Subscribe to FL update topics:

```bash
# Monitor updates from embedded proplet
mosquitto_sub -h localhost -t "fl/rounds/round-1/updates/embedded-proplet-1" -v

# Monitor all FL updates
mosquitto_sub -h localhost -t "fl/rounds/+/updates/+" -v
```

**Expected MQTT Message**:
```json
{
  "round_id": "round-1",
  "proplet_id": "embedded-proplet-1",
  "base_model_uri": "fl/models/global_model_v0",
  "num_samples": 512,
  "metrics": {
    "loss": 0.75
  },
  "update": {
    "w": [0.1, 0.2, 0.3],
    "b": 0.05
  }
}
```

### Step 8: Verify Coordinator Receives Updates

Check coordinator logs:

```bash
docker compose -f compose-http.yaml logs -f coordinator-http
```

**Expected Logs**:
```
INFO Received update round_id=round-1 proplet_id=embedded-proplet-1 total_updates=1 k_of_n=3
INFO Aggregating updates round_id=round-1 num_updates=1
INFO Aggregated model saved version=1
```

### Expected Results for Embedded Proplet FL Demo

#### Successful Execution Flow

1. **Task Creation**: Manager creates task with `ROUND_ID` environment variable
2. **Task Start**: Embedded proplet receives start command via MQTT
3. **FL Detection**: Proplet detects FL task via `ROUND_ID`
4. **Data Fetching**:
   - Model fetched from Model Registry via HTTP GET
   - Dataset fetched from Local Data Store via HTTP GET
   - Data stored in `g_current_task.model_data` and `g_current_task.dataset_data`
5. **WASM Execution**:
   - WASM module loaded into WAMR runtime
   - Host functions registered (`get_proplet_id`, `get_model_data`, `get_dataset_data`)
   - WASM module calls host functions to retrieve data
   - Local training performed within WASM module
   - JSON update output to stdout
6. **Update Publication**:
   - Proplet captures stdout (JSON update)
   - Proplet parses JSON and validates structure
   - Proplet publishes to MQTT: `fl/rounds/{round_id}/updates/{proplet_id}`
7. **Aggregation**: Coordinator receives update and aggregates when `k_of_n` threshold reached

#### Expected Proplet Log Messages

```
[INFO] Received start command for task fl-task-embedded-1
[INFO] FML task detected: ROUND_ID=round-1
[INFO] Setting PROPLET_ID=embedded-proplet-1 from config
[INFO] Fetching model from registry: http://model-registry:8081/models/0
[INFO] Model fetch successful: 123 bytes
[INFO] Fetching dataset from data store: http://local-data-store:8083/datasets/embedded-proplet-1
[INFO] Dataset fetch successful: 456 bytes
[INFO] Executing WASM module with host functions
[INFO] WASM execution completed successfully
[INFO] Captured stdout: {"round_id":"round-1","proplet_id":"embedded-proplet-1",...}
[INFO] Published FML update to fl/rounds/round-1/updates/embedded-proplet-1
```

#### Key Differences from Rust Proplet Demo

| Aspect | Rust Proplet | Embedded Proplet |
|--------|--------------|------------------|
| **Update Submission** | HTTP POST first, MQTT fallback | MQTT only |
| **WASM Compilation** | Standard Go (`GOOS=wasip1`) | TinyGo (`tinygo build -target=wasi`) |
| **WASM Size** | ~4-5 MB | ~100-200 KB |
| **Data Access** | Environment variables | Host functions + env vars |
| **Runtime** | Wasmtime (external process) | WAMR (embedded in Zephyr) |
| **Model/Dataset Fetch** | Handled by WASM module | Fetched by proplet before execution |

### Troubleshooting Embedded Proplet FL Demo

#### Host Functions Not Available

**Symptoms**:
- WASM module logs indicate host functions not found
- `get_proplet_id()` returns 0 (failure)

**Solution**:
1. Verify embedded proplet built with latest `wasm_handler.c`
2. Check host function registration in WAMR initialization
3. Verify native symbols registered: `wasm_runtime_register_natives()`
4. Example code falls back to `os.Getenv()` for compatibility

#### Model/Dataset Not Fetched

**Symptoms**:
- Proplet logs show HTTP fetch errors
- `MODEL_DATA` or `DATASET_DATA` empty in WASM module

**Solution**:
1. Check HTTP connectivity from embedded proplet to services
2. Verify URLs in environment variables are correct
3. Check proplet logs for HTTP errors: `[ERR] Failed to fetch model: ...`
4. Verify Model Registry and Data Store are accessible
5. Example code uses synthetic data as fallback if fetch fails

#### Update Not Published to MQTT

**Symptoms**:
- Proplet execution completes but no MQTT message
- Coordinator doesn't receive update

**Solution**:
1. Check MQTT connection status in proplet logs
2. Verify `ROUND_ID` is set correctly in task environment
3. Ensure WASM module outputs valid JSON to stdout
4. Check proplet logs for MQTT publish errors
5. Verify MQTT topic format: `fl/rounds/{round_id}/updates/{proplet_id}`

#### WASM Module Fails to Load

**Symptoms**:
- Proplet logs show WAMR initialization errors
- Task fails with WASM-related errors

**Solution**:
1. Verify WASM module compiled with TinyGo targeting `wasi`
2. Check WASM file is valid: `file fl-client.wasm` should show WebAssembly
3. Verify WAMR runtime supports required WASI features
4. Check embedded proplet has sufficient memory (40 KB heap pool)
