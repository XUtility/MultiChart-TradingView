// Hide the console window on Windows release builds (GUI subsystem).
// Without this the app always spawns a cmd.exe console window next to the main window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
