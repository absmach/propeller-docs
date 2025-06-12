# Embedded Proplet

## WAMR Integration in the Embedded Proplet

Propeller integrates [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) within its decentralized worker-node framework, enabling distributed execution of WASM workloads on [Zephyr](https://www.zephyrproject.org/)-based embedded devices through the embedded proplet. The WAMR runtime is integrated into the Propeller project as a Git submodule, ensuring modular dependency management and streamlined updates. The integration is defined within the CMakeLists.txt configuration, where WAMR is compiled as part of the Zephyr build system. The embedded proplet explicitly configures WAMR for the ESP32-S3 (XTENSA) architecture by setting `WAMR_BUILD_PLATFORM="zephyr"` and `WAMR_BUILD_TARGET="XTENSA"`. Other target options include `"ARM"`, `"RISCV"`, `"X86_64"`, and `"MIPS"`, making the embedded proplet adaptable to a wide range of embedded architectures beyond XTENSA.

To ensure an optimal balance between performance and flexibility in embedded environments, the embedded proplet is configured to support both interpreter mode (`WAMR_BUILD_INTERP=1`) and ahead-of-time (AOT) compilation (`WAMR_BUILD_AOT=1`). The above configuration allows for efficient execution of pre-compiled WASM modules while retaining the ability to interpret dynamically loaded binaries. Disabling the interpreter (`WAMR_BUILD_INTERP=0`) mandates the use of AOT-compiled modules, potentially improving runtime efficiency but limiting flexibility. Conversely, disabling AOT (`WAMR_BUILD_AOT=0`) forces reliance on interpretation, which may introduce performance overhead but ensures broader compatibility for modules that have not been precompiled. The built-in WAMR libc (`WAMR_BUILD_LIBC_BUILTIN=1`) is utilized instead of [WASI](https://github.com/WebAssembly/WASI), as full WASI support in Zephyr is still evolving. Furthermore, a global heap pool (`WAMR_BUILD_GLOBAL_HEAP_POOL=1`) is allocated with a size of 40 KB (`WAMR_BUILD_GLOBAL_HEAP_SIZE=40960`), ensuring efficient memory management for WASM execution.

## Extending the Zephyr Build System for WAMR Integration

To integrate WAMR seamlessly within the Zephyr build system, the following configurations and module definitions are applied. First, the build system includes `runtime_lib.cmake` from the WAMR repository, ensuring that all necessary runtime components are compiled as part of the Zephyr application. The approach enables the embedded proplet to efficiently execute WASM workloads while using Zephyr’s build and dependency management capabilities. Additionally, the Zephyr build system is extended to recognize WAMR as an integral part of the embedded proplet by modifying the `ZEPHYR_EXTRA_MODULES` variable. The modification ensures that the WAMR repository path is explicitly included, allowing Zephyr to treat WAMR as a native library. Consequently, WAMR’s runtime components are automatically included during the firmware compilation process, avoiding manual dependency management.

To establish a direct connection between the application and WAMR’s execution environment, the build system explicitly includes WAMR’s core runtime headers and source files. This guarantees that the WebAssembly engine is properly compiled and linked within the firmware, ensuring smooth execution of WASM workloads.

Finally, WAMR is embedded into the Zephyr application as a dedicated library using `zephyr_library_named(wamr_lib)`. The application then links WAMR with the Zephyr build system through `target_link_libraries(app PRIVATE wamr_lib)`, allowing the WASM execution environment to be tightly integrated with the Zephyr firmware.

## WASM Handler

The WASM handler, implemented in `wasm_handler.c` and `wasm_handler.h`, serves as the primary interface between the embedded proplet and the embedded device. It is responsible for reading binary WebAssembly modules, validating their integrity, and loading the wasm modules into WAMR’s runtime. The validation step ensures that corrupted or malformed modules do not compromise system stability. Once a WASM module is loaded, the handler initializes the runtime environment to ensure proper execution. The initialization includes allocating a dedicated stack (16 KB) and heap (16 KB) using `wasm_runtime_instantiate()`. To support concurrent execution of multiple WASM workloads, the handler maintains an array where each running module is tracked with a unique task ID. The implementation of the embedded proplet also ensures that WASM modules can be explicitly terminated, freeing memory and execution slots when no longer needed.

For WASM modules to interact with external hardware and networking components, the embedded proplet exposes controlled system interfacing methods. The methods provide secure access to essential embedded system capabilities, including:

- Publishing results over MQTT: The handler enables the embedded proplet to send execution results to the Manager using `publish_results()`, facilitating seamless communication with the Manager.
- Interacting with external inputs: Embedded Proplets receive dynamic inputs through a defined input structure (`inputs[MAX_INPUTS]`), allowing parameterized execution of WebAssembly code
- Performing logging and debugging: The embedded proplet integrates with Zephyr’s logging framework, ensuring that execution logs and error messages are captured for real-time monitoring and debugging.

Since embedded devices have limited resources, the WASM handler enforces strict memory isolation and execution constraints to maintain system reliability. This is achieved through:

- Creating execution environments: Each WASM module operates within a sandboxed memory region, using `wasm_runtime_create_exec_env()`, preventing unintended access to system memory.
- Limiting execution time and memory usage: The WASM handler enforces a predefined memory allocation (e.g., a global heap size of 40 KB) to prevent system-wide memory exhaustion.
- Handling runtime exceptions: The system continuously monitors for execution errors using `wasm_runtime_get_exception()`. If an error occurs, it is logged, and the execution is halted to prevent cascading failures.

For WebAssembly modules to interact with hardware and networking components, the WASM handler facilitates controlled access to system interfaces. The controlled access is achieved by exposing custom host functions, which allow WebAssembly code to:

- Publish results over MQTT: Using `publish_results()`, execution results from a WASM module can be sent over an MQTT channel.
- Interact with external inputs: WASM functions can receive input values (`inputs[MAX_INPUTS]`) that modify their behavior dynamically.
- Perform logging and debugging: The handler integrates with Zephyr’s logging system, providing real-time execution feedback.

## Ensuring Memory Isolation and Stability

Since embedded devices have limited resources, the WASM handler enforces strict memory constraints and execution limits. This is done by:

- Creating execution environments using `wasm_runtime_create_exec_env()`, which ensures each WASM module operates in a sandboxed memory region.
- Limiting execution time by enforcing predefined memory allocations (e.g., 40 KB global heap) to prevent system-wide memory exhaustion.
- Handling runtime exceptions by checking for error messages from `wasm_runtime_get_exception()`, preventing runtime crashes caused by invalid operations.

A key aspect of WAMR integration is ensuring sandboxed execution. Each WASM module operates in an isolated environment, with controlled access to system resources. The WASM handler enforces strict memory and execution limits, preventing any single module from consuming excessive resources or interfering with other processes. Additionally, the system enables secure inter-process communication between WASM modules and native Zephyr components, allowing WebAssembly workloads to interact with hardware peripherals and networking functions through a well-defined API.

Propeller also leverages WAMR’s extensibility by incorporating custom host functions. These functions allow WASM modules to perform operations such as network communication, sensor data acquisition, and logging. By defining specific host functions, Propeller enables WASM workloads to execute efficiently while maintaining security and stability within the embedded environment.

Another critical component of the WAMR integration is task scheduling and workload management. The orchestrator assigns WASM tasks to available proplets based on resource availability, with the WASM handler dynamically managing execution priorities. Each proplet periodically reports its workload status to the orchestrator, enabling real-time load balancing and task reassignment if needed.

## Task Scheduling and Resource Management

The Propeller Orchestrator dynamically assigns workloads to proplets based on resource availability, power constraints, and scheduling priorities. Each proplet operates independently while receiving tasks from the orchestrator, executing them in an isolated runtime environment. This design guarantees security and stability while preventing resource contention among different workloads.

The embedded proplet system is structured into the following components:

The networking and connectivity components of the embedded proplet are built upon the networking stack of Zephyr, providing robust support for WiFi and IP-based communication. The configuration file enables WiFi networking and network management, allowing devices to establish and maintain wireless connections effectively. The system also supports general networking capabilities through the network management layer of Zephyr, which enables runtime control and configuration of networking interfaces.

The system relies on DHCPv4 for dynamic IP address allocation, ensuring that each embedded proplet can automatically obtain an IP address when connecting to the network. The above eliminates the need for static IP configurations and allows seamless integration into existing network infrastructures. Additionally, the networking stack supports both TCP and UDP, ensuring compatibility with various communication protocols used in distributed systems. To manage multiple network interfaces, the configuration allows up to two IPv4 addresses, configured through `CONFIG_NET_IF_MAX_IPV4_COUNT=2`, per network interface. Though IPv6 support is available, it is disabled in the configuration file, as the embedded proplet currently prioritizes IPv4 networking. At the link-layer level, the system enables Ethernet and WiFi management, ensuring that edge devices connect using standard networking interfaces. The configuration file also specifies a maximum of two managed WiFi interfaces, allowing the system to handle multiple WiFi connections efficiently.

Packet and buffer management is fine-tuned to optimize networking performance for embedded devices, where memory and processing power are constrained and can lead to dropped packets, increased retransmissions, and degraded communication efficiency. The configuration sets `CONFIG_NET_BUF_RX_COUNT=64` and `CONFIG_NET_BUF_TX_COUNT=64`, ensuring that sufficient buffers are allocated for incoming and outgoing network packets to reduce packet loss and improve transmission reliability. Similarly, `CONFIG_NET_PKT_RX_COUNT=32` and `CONFIG_NET_PKT_TX_COUNT=32` define the number of packet descriptors available for processing network traffic, balancing memory usage and network performance. The dedicated memory allocations for networking tasks `CONFIG_NET_RX_STACK_SIZE=2048` and `CONFIG_NET_TX_STACK_SIZE=2048`, further improve the responsiveness and stability of the system in handling concurrent network operations. Additionally, `CONFIG_NET_MAX_CONTEXTS=10` ensures that multiple networking contexts can be managed concurrently, allowing seamless handling of multiple network sockets, connections, or protocols.

A key aspect of connectivity in the embedded proplet is the integration of MQTT for message-based communication. The configuration enables the MQTT library and socket support for seamless data exchange between Propeller nodes and the orchestrator. The MQTT client is configured to maintain session state and use a keep-alive mechanism to ensure continuous connectivity.

To enhance reliability, the embedded proplet supports the Last Will and Testament (LWT) feature of MQTT. The feature ensures that in the event of an unexpected disconnection of the embedded proplet, a predefined message is sent to the broker, notifying the Manager of the disconnection event. Additionally, the embedded proplet leverages Quality of Service (QoS) levels to provide varying degrees of message reliability, ensuring that critical messages are received without duplication or loss. The configuration also allows for adaptive reconnection strategies, ensuring that embedded proplets can re-establish connections in case of temporary network disruptions.

For debugging and diagnostics, the configuration enables logging with a default logging level of 3. This provides useful insights into networking operations without excessive verbosity. The system also supports early console output (`CONFIG_EARLY_CONSOLE=y`) and network statistics tracking (`CONFIG_NET_STATISTICS=y`), allowing developers to monitor network performance and diagnose potential issues efficiently.

- WASM Handler : Interfaces with WAMR to load, execute, and manage WASM modules on the embedded device, enforcing isolation and resource constraints.
- Configuration and Build System: Defines system parameters, dependencies, and build instructions to streamline deployment on Zephyr OS.
- Data Serialization: Handles encoding and decoding of structured data in JSON format for efficient message parsing within the Propeller network.
