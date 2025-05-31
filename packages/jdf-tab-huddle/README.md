# Tab Organizer Chrome Extension

A Chrome extension for organizing and sorting tabs by URL and domain.

## Features

- **Sort All Tabs**: Sort all tabs across all windows by URL
- **Sort Current Window**: Sort tabs in the current window by URL
- **Extract Domain**: Move all tabs from the current domain into a new window

## Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the `src` folder from this project

## Usage

Click on the extension icon in the Chrome toolbar to open the popup menu, then:

- Click "Sort All Tabs (All Windows)" to sort all tabs by URL across all windows
- Click "Sort Tabs in Current Window" to sort tabs by URL in the current window only
- Click "Extract Current Domain" to move all tabs with the same domain as the active tab into a new window

## Permissions

This extension requires the `tabs` permission to read and manipulate browser tabs.

## License

This project is open-source and available under the MIT License.