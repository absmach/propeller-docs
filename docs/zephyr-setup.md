# Deploying WAMR on Zephyr for ESP32

## **1. Set Up Zephyr Development Environment**

### Install Dependencies on your development machine

Update your system:

```bash
sudo apt update
sudo apt upgrade
```

Install the required tools:

```bash
sudo apt install --no-install-recommends git cmake ninja-build gperf \
  ccache dfu-util device-tree-compiler wget \
  python3-dev python3-pip python3-setuptools python3-tk python3-wheel xz-utils file \
  make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1
```

Verify tool versions:

```bash
cmake --version
python3 --version
dtc --version
```

Ensure versions meet the minimum requirements: CMake 3.20.5, Python 3.10, and Devicetree Compiler 1.4.6.

### Get Zephyr and Python Dependencies on your development machine

Create a Zephyr workspace and clone the repository:

```bash
west init ~/zephyrproject
cd ~/zephyrproject
west update
```

Set up a Python virtual environment:

```bash
sudo apt install python3-venv
python3 -m venv ~/zephyrproject/.venv
source ~/zephyrproject/.venv/bin/activate
pip install west
```

Export Zephyr CMake package:

```bash
west zephyr-export
```

Install Python dependencies:

```bash
west packages pip --install
```

Install the Zephyr SDK:

```bash
cd ~/zephyrproject/zephyr
west sdk install
```

You can also install Zephyr SDK without using the west sdk command, as described in this [Zephyr SDK installation guide] (https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html#toolchain-zephyr-sdk-install).

Fetch Espressif binary blobs:

```bash
west blobs fetch hal_espressif
```

The `ZEPHYR_BASE` environment variable is essential for locating Zephyr's core build system, CMake scripts, and modules. Without this variable set, Zephyr tools like `west` will fail to build applications.

To confirm whether the `ZEPHYR_BASE` environment variable is configured correctly, use the following command:

```bash
echo $ZEPHYR_BASE
```

If the output is empty or incorrect, follow the steps below to set it.

1. **Activate your Zephyr Virtual Environment**:

   If you're using a virtual environment for Zephyr, activate it first:

   ```bash
   source ~/zephyrproject/.venv/bin/activate
   ```

2. **Set the `ZEPHYR_BASE` Variable**:

   Once activated, set the `ZEPHYR_BASE` variable to point to the Zephyr directory:

   ```bash
   export ZEPHYR_BASE=~/zephyrproject/zephyr
   ```

3. **Make the Change Permanent**:

   To ensure the `ZEPHYR_BASE` variable is set automatically in future sessions, add the following line to your shell's configuration file (`.bashrc` for Bash or `.zshrc` for Zsh):

   ```bash
   export ZEPHYR_BASE=~/zephyrproject/zephyr
   ```

   After adding the line, apply the changes by running:

   ```bash
   source ~/.bashrc   # For Bash users
   source ~/.zshrc    # For Zsh users
   ```

- For more information on Zephyr environment variables, visit the [Zephyr Environment Variables Documentation](https://docs.zephyrproject.org/latest/develop/env_vars.html#env-vars-important).
- For a comprehensive guide on setting up Zephyr, refer to the official [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html).
- For board-specific information, such as the [Espressif ESP32-S3 DevKitC](https://docs.zephyrproject.org/latest/boards/espressif/esp32s3_devkitc/doc/index.html), refer to the official documentation for setup and configuration details.
- To see the full list of supported boards, refer to the [Zephyr Board Documentation](https://docs.zephyrproject.org/latest/boards/index.html#boards=).

## **2. Install ESP-IDF on your development machine**

Do not install ESP-IDF inside the Zephyr virtual environment. ESP-IDF is a separate development framework with its own setup and toolchain requirements, which should be installed and managed globally or in its own isolated environment. Global Installation (Preferred). This way, its tools and environment are available for any project on the ESP32, including Zephyr.

Without ESP-IDF:

- You cannot compile or flash code for the ESP32.
- Zephyr won’t be able to recognize or support the ESP32-S3 during build or runtime.

### Option 1: Using VS Code Extension (Recommended)

Install the ESP-IDF extension:

- Navigate to **View > Extensions** in VS Code.
- Search for "ESP-IDF Extension" and install it.

Configure the ESP-IDF extension:

- Open **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`).
- Run `ESP-IDF: Configure ESP-IDF Extension`.
- Follow the setup wizard to download and install ESP-IDF.

Ensure correct paths for IDF:

- Set `IDF_PATH` and `IDF_TOOLS_PATH` appropriately (default: `$HOME/.espressif`).

Add OpenOCD rules for Linux. The command typically looks like:

```bash
sudo cp --update=none /home/<username>/.espressif/tools/openocd-esp32/<version>/share/openocd/contrib/60-openocd.rules /etc/udev/rules.d/
```

then reload udev rules to apply the changes:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

For more detailed information, refer to the official [ESP-IDF Extension Guide](https://docs.espressif.com/projects/vscode-esp-idf-extension/en/latest/installation.html).

### Option 2: Manual Installation

Download ESP-IDF:

```bash
mkdir -p ~/esp
cd ~/esp
wget https://github.com/espressif/esp-idf/releases/download/v5.3.2/esp-idf-v5.3.2.zip
unzip esp-idf-v5.3.2.zip -d v5.3.2
```

Ensure the directory structure is correct after unzipping. The export script requires paths to be consistent.

Export the ESP-IDF environment:

```bash
source ~/esp/v5.3.2/esp-idf/export.sh
```

Run this command in every new terminal session, or automate it by adding the export command to your shell's startup script (~/.bashrc, ~/.zshrc, etc.).

Verify the installation:

Check the installed ESP-IDF version:

```bash
idf.py --version

```

If the `idf.py` command fails with `command not found`, source the ESP-IDF Environment in VS Code. To avoid manually sourcing the `export.sh` script every time you open a terminal:

- Open your shell configuration file (`~/.zshrc` or `~/.bashrc`):

  ```bash
  nano ~/.zshrc
  ```

- Add this line at the bottom:

  ```bash
  source ~/esp/v5.3.2/esp-idf/export.sh
  ```

- Save and reload the shell configuration:

  ```bash
  source ~/.zshrc
  ```

- Once the environment is sourced:

  - Check the Xtensa toolchain:

    ```bash
    xtensa-esp32s3-elf-gcc --version
    ```

  - Verify `idf.py` again:

    ```bash
    idf.py --version
    ```

---

### **3. Test Zephyr's Integration with ESP-IDF**

Navigate to your Zephyr workspace:

```bash
cd ~/zephyrproject
```

Activate the virtual environment. This ensures that Zephyr tools (e.g., west, CMake) and configurations are properly used during the build process.

```bash
source .venv/bin/activate
```

Build the Hello World sample:

```bash
west build -b esp32s3_devkitc/esp32s3/procpu zephyr/samples/hello_world
```

Flash the firmware:

```bash
west flash
```

Monitor the output:

```bash
west espressif monitor
```

A successful run shows that the entire build-flash-boot-debug toolchains are functional for your development board.

NOTE:

- Before building, list all supported boards to verify the correct target name. Look for your desired board in the output of:

  ```bash
  west boards
  ```

  A board may contain one or multiple SoCs. Also, each SoC may contain one or more CPU clusters as described in [The board qualifiers](https://docs.zephyrproject.org/latest/hardware/porting/board_porting.html#board-terminology)

  For the ESP32-S3-DevKitC, the build system expects either of these qualified targets:

      - `esp32s3_devkitc/esp32s3/procpu` (for the primary processor core, which we will use in this example)
      - `esp32s3_devkitc/esp32s3/appcpu` (for the application processor core)

- If you see the message `ninja: no work to do`, it means the build system has detected no changes since the last build, and no new compilation is needed. Use the `--pristine` flag to ensure a completely clean build environment:

  ```bash
  west build -b esp32s3_devkitc/esp32s3/procpu zephyr/samples/hello_world --pristine
  ```

- Use `west flash --erase` if the board has residual firmware causing conflicts.
- Ensure that `west espressif monitor` is not running when you attempt to flash the firmware. It keeps the serial port busy, preventing the `west flash` command from accessing it.

---

## Using WebAssembly Micro Runtime (WAMR) with Zephyr

### Step 1: Clone WAMR repository

```bash
cd ~/zephyrproject
git clone https://github.com/bytecodealliance/wasm-micro-runtime.git
```

After running the above commands, your folder structure will look like this:

```plaintext
~/zephyrproject/
├── zephyr/
├── modules/
├── wasm-micro-runtime/
```

> **Note:** It's not necessary to clone WAMR inside the `zephyrproject` folder, but it’s easier to keep everything organized in one place. If you choose to place it elsewhere, you will need to update some configuration files to point to the correct location of the WAMR repository.

### Step 2: Update CMakeLists.txt (Optional)

If you decided to place the WAMR repository outside of the `zephyrproject` folder, you will need to tell Zephyr where to find it. You can do this by updating your `CMakeLists.txt` file.

Add these lines:

```bash
set(WAMR_ROOT /path/to/wasm-micro-runtime)
include(${WAMR_ROOT}/build-scripts/runtime_lib.cmake)
```

Make sure to replace `/path/to/wasm-micro-runtime` with the actual path where you placed the WAMR source.

### Step 3: Test Your Installation

To make sure everything is set up correctly, build and run a test application.

1. Go to the `basic` sample directory:

   ```bash
   cd samples/basic
   ```

2. Inside the `basic` sample folder, you’ll find a script called `build.sh`. This script compiles both the native application and the WebAssembly (WASM) application. To build the project, run:

   ```bash
   ./build.sh
   ```

3. After the build finishes, you will find the output files in the `out` directory. To run the test application, go to the `out` folder:

   ```bash
   cd out
   ```

4. Run the application with the following command:

   ```bash
   ./basic -f wasm-apps/testapp.wasm
   ```

You should see output like this:

```bash
calling into WASM function: generate_float
Native finished calling wasm function generate_float(), returned a float value: 102009.921875f
calling into WASM function: float_to_string
calling into native function: intToStr
calling into native function: get_pow
calling into native function: intToStr
Native finished calling wasm function: float_to_string, returned a formatted string: 102009.921
```

### Step 4: Clean Build Artifacts

If you want to clean up the build files, simply run:

```bash
./build.sh clean
```

### Step 5: Deploy WAMR on Zephyr for ESP32

After testing WAMR locally, deploy it to the **ESP32** board using Zephyr.

1. Go to the WAMR example directory for Zephyr:

   ```bash
   cd ~/zephyrproject/wasm-micro-runtime/product-mini/platforms/zephyr/simple
   ```

2. If you haven’t already, activate your Zephyr virtual environment:

   ```bash
   source ~/zephyrproject/.venv/bin/activate
   ```

3. Build the WAMR example for your **ESP32** board. Replace `<your_board>` with your specific board name, like `esp32s3_devkitc`:

   ```bash
   west build -b <your_board>
   ```

4. Flash the firmware to your ESP32 board:

   ```bash
   west flash
   ```

5. To see what's happening on the board, open the serial monitor:

   ```bash
   west espressif monitor
   ```

### **Using a WebAssembly Module with Zephyr**

The sample C code is in `src/wasm-app-riscv64/main.c`. To generate a `.wasm` file, run the build script located in `src/wasm-app-riscv64/build.sh`.

```bash
./build.sh
```

This creates `test.wasm`, `test_wasm.h`, and `test_wasm_riscv64.h`. Replace `src/test_wasm.h` and `src/test_wasm_riscv64.h` with the newly generated files from `src/wasm-app-riscv64`.

Build the firmware (replace `<your_board>` with the board name):

```bash
west build -b <your_board>
```

Flash the firmware:

```bash
west flash
```

Use the serial monitor to see output:

```bash
west espressif monitor
```

---

## **Potential Pitfalls and Solutions**

### **1. Permission Denied for `/dev/ttyUSB0`**

Add your user to the `dialout` group then log out and log back in or restart the system.:

     ```bash
     sudo usermod -aG dialout $USER
     ```

### **2. `west` Not Found**

Activate the virtual environment:

    ```bash
    source ~/zephyrproject/.venv/bin/activate
    ```

### **3. Build Fails with Missing Board Qualifiers**

Use the correct board target as described in [The board qualifiers](https://docs.zephyrproject.org/latest/hardware/porting/board_porting.html#board-terminology). For ESP32s3, for example:

    ```bash
    west build -b esp32s3_devkitc/esp32s3/procpu zephyr/samples/hello_world
    ```

### **4. Serial Port Already in Use**

1. Identify the process using the port and kill it:

   ```bash
   lsof /dev/ttyUSB0
   kill <PID>
   ```

### 5. CMake source directory mismatch

Clear the existing CMake cache to resolve the mismatch by deleting the `build` directory and then re-run the `west build` command.

```bash
rm -rf ~/zephyrproject/zephyr/build
```
