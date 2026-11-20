# Setup app design notes

**Reference:** the macOS Installer (`Installer.app`), the step-by-step window every Mac `.pkg` opens in (Python's and Node's installers, for example).
We copy its layout and behaviour, not its artwork: no Apple icons, logos or window buttons.

## Anatomy we copied

| Part | macOS Installer | Ours (`ui.html`) |
|---|---|---|
| Window | one fixed window, title "Install ‹App›" centred in the title bar | centred 860px window, title bar "Install Free Coding Helpers" |
| Step list | left sidebar: Introduction, Read Me, License, Destination Select, Installation Type, Installation, Summary | left sidebar: Introduction, Destination, Installation, Free AI keys, Summary |
| Step states | current step bold; done steps a filled dot; steps to come grey | current: bold + blue dot; done: grey filled dot; to come: grey ring |
| Sidebar art | the package icon, faded, bottom left | our own icon (code braces in a rounded square) at 16% opacity |
| Page title | one bold line above the content ("Welcome to the ‹App› Installer") | one per page, 20px semibold |
| Content pane | white inset box, thin border, everything inside it | same; dark pane in dark mode |
| Buttons | bottom right: "Go Back" (plain), then "Continue" / "Install" (blue, the default); extra actions on the left | same order; "Skip for now" sits on the left on the keys page |
| Before install | Installation Type page says how much space and time the install takes, next to the Install button | Destination page says what will download and about how long, next to Install |
| Installing | status line, thin progress bar, "time remaining"; the log is hidden away (Window > Installer Log) | status line, thin bar, elapsed time; the log is behind "Show details" |
| Summary | big green check, "The installation was successful.", Close | same, plus the one step left (connect your coding app); turns red with "!" if a step failed |

## Tokens

| Token | Light | Dark | Source |
|---|---|---|---|
| accent (`--acc`) | `#007AFF` | `#0A84FF` | Apple system blue |
| success (`--ok`) | `#248A3D` | `#30D158` | system green (light uses the high-contrast variant so text stays readable) |
| error (`--bad`) | `#D70015` | `#FF453A` | system red (light: high-contrast variant) |
| window (`--win`) | `#ECECEC` | `#2C2C2E` | window background |
| pane (`--pane`) | `#FFFFFF` | `#1C1C1E` | content background |
| text / muted | `#1D1D1F` / `#6E6E73` | `#F5F5F7` / `#98989D` | label / secondary label |
| border / hairline | `#C6C6C8` / `#E5E5EA` | `#48484A` / `#38383A` | separator colours |

- **Font:** the system font (San Francisco on Mac, Segoe UI on Windows). Body 14px, titles 20px semibold, buttons 13px medium.
- **Shape:** window radius 12px, pane 8px, buttons and inputs 6px. Spacing on a 4px grid.
- **Progress bar:** 6px tall, rounded, blue on a hairline track; it slides back and forth when the length of a step is unknown.

## Where we differ on purpose

- **No red/yellow/green window buttons.** In a browser they would look clickable and do nothing.
- **Body text 14px, not 13px**, because many users are beginners on Windows laptops.
- **The keys page uses a numbered list you can open in any order.** The macOS Installer has nothing like it; the numbers and green ticks match the sidebar's states.
- **Phone-width windows:** the sidebar becomes a row of dots with only the current step named, and the window fills the screen.
