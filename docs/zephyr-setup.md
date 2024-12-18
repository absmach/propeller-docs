# Setting Up Zephyr with ESP-IDF for ESP32

### **1. Set Up Zephyr Development Environment**

#### Install Dependencies on your development machine

1. Update your system:

   ```bash
   sudo apt update
   sudo apt upgrade
   ```

2. Install the required tools:

   ```bash
   sudo apt install --no-install-recommends git cmake ninja-build gperf \
     ccache dfu-util device-tree-compiler wget \
     python3-dev python3-pip python3-setuptools python3-tk python3-wheel xz-utils file \
     make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1
   ```

3. Verify tool versions:
   ```bash
   cmake --version
   python3 --version
   dtc --version
   ```
   Ensure versions meet the minimum requirements: CMake 3.20.5, Python 3.10, and Devicetree Compiler 1.4.6.

#### Get Zephyr and Python Dependencies on your development machine

1. Create a Zephyr workspace and clone the repository:

   ```bash
   west init ~/zephyrproject
   cd ~/zephyrproject
   west update
   ```

2. Set up a Python virtual environment:

   ```bash
   sudo apt install python3-venv
   python3 -m venv ~/zephyrproject/.venv
   source ~/zephyrproject/.venv/bin/activate
   pip install west
   ```

3. Export Zephyr CMake package:

   ```bash
   west zephyr-export
   ```

4. Install Python dependencies:

   ```bash
   west packages pip --install
   ```

5. Install the Zephyr SDK:

   ```bash
   cd ~/zephyrproject/zephyr
   west sdk install
   ```

6. Fetch Espressif binary blobs:

   ```bash
   west blobs fetch hal_espressif
   ```

   The `ZEPHYR_BASE` variable is required to locate Zephyr's core build system, CMake scripts, and modules. Without it, the Zephyr tools (west) will fail to build applications. Confirm the `ZEPHYR_BASE` Environment Variable

   ```bash
   echo $ZEPHYR_BASE
   ```

   If It’s Not Set:

- Activate your Zephyr virtual environment:

  ```bash
  source ~/zephyrproject/.venv/bin/activate
  ```

- Set the ZEPHYR_BASE variable:

  ```bash
  export ZEPHYR_BASE=~/zephyrproject/zephyr
  ```

  To make it peremanent, add the following line to your shell configuration file (`.bashrc` or `.zshrc`):

  ```bash
  export ZEPHYR_BASE=/home/jeff/zephyrproject/zephyr
  ```

  For more detailed information, refer to the official [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html).

---

### **2. Install ESP-IDF on your development machine**

Do not install ESP-IDF inside the Zephyr virtual environment. ESP-IDF is a separate development framework with its own setup and toolchain requirements, which should be installed and managed globally or in its own isolated environment. Global Installation (Preferred). This way, its tools and environment are available for any project on the ESP32, including Zephyr.

Without ESP-IDF:

- You cannot compile or flash code for the ESP32.
- Zephyr won’t be able to recognize or support the ESP32-S3 during build or runtime.

#### Option 1: Using VS Code Extension (Recommended)

1. Install the ESP-IDF extension:

   - Navigate to **View > Extensions** in VS Code.
   - Search for "ESP-IDF Extension" and install it.

2. Configure the ESP-IDF extension:

   - Open **Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`).
   - Run `ESP-IDF: Configure ESP-IDF Extension`.
   - Follow the setup wizard to download and install ESP-IDF.

3. Ensure correct paths for IDF:

   - Set `IDF_PATH` and `IDF_TOOLS_PATH` appropriately (default: `$HOME/.espressif`).

4. Add OpenOCD rules for Linux. The command typically looks like:

   ```bash
   sudo cp --update=none /home/<username>/.espressif/tools/openocd-esp32/<version>/share/openocd/contrib/60-openocd.rules /etc/udev/rules.d/
   ```

   then reload udev rules to apply the changes:

   ```bash
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

   For more detailed information, refer to the official [ESP-IDF Extension Guide](https://docs.espressif.com/projects/vscode-esp-idf-extension/en/latest/installation.html).

#### Option 2: Manual Installation

1. Download ESP-IDF:

   ```bash
   mkdir -p ~/esp
   cd ~/esp
   wget https://github.com/espressif/esp-idf/releases/download/v5.3.2/esp-idf-v5.3.2.zip
   unzip esp-idf-v5.3.2.zip -d v5.3.2
   ```

   Ensure the directory structure is correct after unzipping. The export script requires paths to be consistent.

2. Export the ESP-IDF environment:

   ```bash
   source ~/esp/v5.3.2/esp-idf/export.sh
   ```

   Run this command in every new terminal session, or automate it by adding the export command to your shell's startup script (~/.bashrc, ~/.zshrc, etc.).

3. Verify the installation:

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

### **3. Test the Setup Using the Hello World Program**

#### Build and Flash Hello World

1. Navigate to your Zephyr workspace:

   ```bash
   cd ~/zephyrproject
   ```

2. Activate the virtual environment:

   ```bash
   source .venv/bin/activate
   ```

   Build and flash the Zephyr Hello World application inside your Zephyr virtual environment. This ensures that Zephyr tools (e.g., west, CMake) and configurations are properly used during the build process.

3. Build the Hello World sample:

   ```bash
   west build -b esp32s3_devkitc/esp32s3/procpu zephyr/samples/hello_world
   ```

   For the ESP32-S3-DevKitC, the build system expects either of these qualified targets:

   - `esp32s3_devkitc/esp32s3/procpu` (for the primary processor core)
   - `esp32s3_devkitc/esp32s3/appcpu` (for the application processor core)

4. Flash the firmware:
   ```bash
   west flash
   ```

#### Monitor the Output

1. Monitor the serial output:

   ```bash
   west espressif monitor
   ```

2. Expected Output:

   ```plaintext
   ***** Booting Zephyr OS build v4.0.0-2253-g62f90c62ab8a *****
   Hello World! esp32s3_devkitc/esp32s3/procpu
   ```

3. To exit the monitor, press `Ctrl + ]`.

---

### **Potential Pitfalls and Solutions**

#### **1. Permission Denied for `/dev/ttyUSB0`**

- **Cause**: User does not have access to the serial port.
- **Solution**:
  1. Add your user to the `dialout` group:
     ```bash
     sudo usermod -aG dialout $USER
     ```
  2. Log out and log back in or restart the system.

#### **2. `west` Not Found**

- **Cause**: Zephyr virtual environment is not activated.
- **Solution**:
  - Activate the virtual environment:
    ```bash
    source ~/zephyrproject/.venv/bin/activate
    ```

#### **3. Build Fails with Missing Board Qualifiers**

- **Cause**: Incorrect board target specified.
- **Solution**:
  - Use the correct board target, for example:
    ```bash
    west build -b esp32s3_devkitc/esp32s3/procpu zephyr/samples/hello_world
    ```

#### **4. Serial Port Already in Use**

- **Cause**: Another process is using `/dev/ttyUSB0`.
- **Solution**:
  1. Identify the process using the port:
     ```bash
     lsof /dev/ttyUSB0
     ```
  2. Kill the process:
     ```bash
     kill <PID>
     ```
  3. Retry flashing.
