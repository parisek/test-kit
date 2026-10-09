# src/config

Reads the global configuration, checks it, and copies the settings used into each run. Spec section 5.

`normalizeConfig(input)` validates JSON data and returns a frozen copy.
`loadConfig(path)` reads JSON and returns the config and absolute runtime paths.
Runtime paths resolve from the configuration directory.

`captureSettings(config, sideId)` selects effective screenshot settings.
`settingsHash(settings)` hashes canonical JSON with sorted object keys.
Neither function reads the filesystem. The hash excludes input origins and paths.

Version 0.1 accepts explicit local origins, list targets and screenshots only.
It rejects unsupported artifacts, checks and unknown configuration keys.
Viewport dimensions range from 1 to 4096. Device scale factors range from 0.5
to 3. A viewport cannot exceed 32 million physical pixels. Capture must also
bound the final full-page image. The extra settle wait is at most 10 seconds.
The screenshot timeout is at most 120 seconds.
