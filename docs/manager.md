# Manager

## Overview

The Manager service is a central component of the Propeller system, responsible for managing tasks and proplets. It provides a set of APIs for task and proplet management, handles task scheduling and execution, and monitors the state of tasks and proplets. The architecture of the Manager service is designed to be modular, scalable, and maintainable, leveraging various components and middleware to achieve these goals.

## Architectural Components

### 1. Service Interface

The `Service` interface defines the core functionalities provided by the Manager service. It includes methods for managing proplets and tasks, as well as for subscribing to MQTT topics. This interface ensures that the service can be easily extended or replaced with different implementations.

### 2. API Endpoints

The Manager service exposes several HTTP endpoints for interacting with tasks and proplets. These endpoints are implemented using the Go-Kit library, which provides a structured way to define and handle HTTP requests and responses.

### 3. Middleware

The Manager service includes several middleware components that enhance its functionality:

- **Logging Middleware:** Logs the details of each service method call, including the duration and any errors that occurred.
- **Metrics Middleware:** Collects metrics for each service method call, such as the number of calls and the latency.
- **Tracing Middleware:** Adds tracing information to each service method call, using OpenTelemetry to provide distributed tracing capabilities.

### 4. Storage

The Manager service uses storage components to persist tasks and proplets. These storage components are abstracted behind interfaces, allowing for different storage implementations (e.g., in-memory, database) to be used interchangeably. The storage components include:

- **Tasks Storage:** Stores task details.
- **Proplets Storage:** Stores proplet details.
- **Task-Proplet Mapping Storage:** Stores the mapping between tasks and proplets.

### 5. Scheduler

The Manager service uses a scheduler to select the appropriate proplet for a task based on certain criteria. The scheduler is responsible for distributing tasks across available proplets in an efficient manner, ensuring optimal resource utilization. The current implementation uses a round-robin scheduler, which selects the next available proplet in a cyclic manner.

### 6. PubSub

The Manager service uses a PubSub component to publish and subscribe to MQTT topics for task and proplet management. This component allows the service to communicate with other components of the Propeller system, such as proplets, to coordinate task execution and monitor their state.

### 7. Internal Handlers

The Manager service includes internal handlers for managing proplets and tasks. These handlers are responsible for processing messages received from MQTT topics and updating the state of tasks and proplets accordingly. The handlers include:

- **Proplet Handlers:** Handle the creation, liveness updates, and result updates of proplets.
- **Task Handlers:** Handle the creation, updating, and deletion of tasks.

### 8. Health and Metrics Endpoints

The Manager service includes endpoints for health checks and metrics collection:

- **Health Endpoint:** Provides a health check endpoint (`/health`) that returns the health status of the service.
- **Metrics Endpoint:** Provides a metrics endpoint (`/metrics`) that exposes Prometheus metrics for the service.

## Data Flow

### 1. Task Creation

- A client sends a `POST` request to the `/tasks` endpoint with the task details.
- The service creates a new task, assigns a unique ID, and stores it in the tasks storage.
- The service returns the created task to the client.

### 2. Task Execution

- A client sends a `POST` request to the `/tasks/{taskID}/start` endpoint to start a task.
- The service retrieves the task from the tasks storage and selects an appropriate proplet using the scheduler.
- The task can also specify which proplet to use.
- The service publishes a start message to the MQTT topic for the selected proplet.
- The proplet executes the task and publishes the results to the MQTT topic.
- The service processes the results and updates the task state in the tasks storage.

### 3. Proplet Management

- Proplets periodically send liveness updates to the MQTT topic.
- The service processes the liveness updates and updates the state of the proplets in the proplets storage.
- The service can also handle the creation of new proplets and the updating of proplet details.
