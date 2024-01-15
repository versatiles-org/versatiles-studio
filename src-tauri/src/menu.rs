use tauri::{Menu, MenuItem, Submenu};

pub fn get_menu() -> Menu {
	Menu::new().add_submenu(Submenu::new("File", Menu::new().add_native_item(MenuItem::Quit)))
}
