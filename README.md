
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Platform Plugin Template

This is a template Homebridge platform plugin and can be used as a base to help you get started developing your own plugin.

This template should be used in conjunction with the [developer documentation](https://developers.homebridge.io/). A full list of all supported service types, and their characteristics is available on this site.

## Clone As Template

Click the link below to create a new GitHub Repository using this template, or click the *Use This Template* button above.

<span align="center">

### [Create New Repository From Template](https://github.com/homebridge/homebridge-plugin-template/generate)

</span>

## Setup Development Environment

To develop this Homebridge plugin you must have Node.js 22.13 or later on the Node 22 line, or Node.js 24, plus Homebridge 2.1 or later. This plugin uses [TypeScript](https://www.typescriptlang.org/) and ESLint. If you are using VS Code install these extensions:

* [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

## Install Development Dependencies

Using a terminal, navigate to the project folder and run this command to install the development dependencies:

```
npm install
```

## Update package.json

Open the [`package.json`](./package.json) and change the following attributes:

* `name` - this should be prefixed with `homebridge-` or `@username/homebridge-` and contain no spaces or special characters apart from a dashes
* `displayName` - this is the "nice" name displayed in the Homebridge UI
* `repository.url` - Link to your GitHub repo
* `bugs.url` - Link to your GitHub repo issues page

When you are ready to publish the plugin you should set `private` to false, or remove the attribute entirely.

## Update Plugin Defaults

Open the [`src/settings.ts`](./src/settings.ts) file and change the default values:

* `PLATFORM_NAME` - Set this to be the name of your platform. This is the name of the platform that users will use to register the plugin in the Homebridge `config.json`.
* `PLUGIN_NAME` - Set this to be the same name you set in the [`package.json`](./package.json) file. 

Open the [`config.schema.json`](./config.schema.json) file and change the following attribute:

* `pluginAlias` - set this to match the `PLATFORM_NAME` you defined in the previous step.

## Build Plugin

TypeScript needs to be compiled into JavaScript before it can run. The following command will compile the contents of your [`src`](./src) directory and put the resulting code into the `dist` folder.

```
npm run build
```

## Link To Homebridge

Run this command so your global install of Homebridge can discover the plugin in your development environment:

```
npm link
```

You can now start Homebridge, use the `-D` flag so you can see debug log messages in your plugin:

```
homebridge -D
```

## Watch For Changes and Build Automatically

If you want to have your code compile automatically as you make changes, and restart Homebridge automatically between changes, you first need to add your plugin as a platform in `~/.homebridge/config.json`:
```
{
...
    "platforms": [
        {
            "name": "Config",
            "port": 8581,
            "platform": "config"
        },
        {
            "name": "<PLUGIN_NAME>",
            //... any other options, as listed in config.schema.json ...
            "platform": "<PLATFORM_NAME>"
        }
    ]
}
```

and then you can run:

```
npm run watch
```

This will launch an instance of Homebridge in debug mode which will restart every time you make a change to the source code. It will load the config stored in the default location under `~/.homebridge`. You may need to stop other running instances of Homebridge while using this command to prevent conflicts. You can adjust the Homebridge startup command in the [`nodemon.json`](./nodemon.json) file.

## Customise Plugin

You can now start customising the plugin template to suit your requirements.

* [`src/platform.ts`](./src/platform.ts) - this is where your device setup and discovery should go.
* [`src/platformAccessory.ts`](./src/platformAccessory.ts) - this is where your accessory control logic should go, you can rename or create multiple instances of this file for each accessory type you need to implement as part of your platform plugin. You can refer to the [developer documentation](https://developers.homebridge.io/) to see what characteristics you need to implement for each service type.
* [`config.schema.json`](./config.schema.json) - update the config schema to match the config you expect from the user. See the [Plugin Config Schema Documentation](https://developers.homebridge.io/#/config-schema).

## Versioning Your Plugin

Given a version number `MAJOR`.`MINOR`.`PATCH`, such as `1.4.3`, increment the:

1. **MAJOR** version when you make breaking changes to your plugin,
2. **MINOR** version when you add functionality in a backwards compatible manner, and
3. **PATCH** version when you make backwards compatible bug fixes.

You can use the `npm version` command to help you with this:

```bash
# major update / breaking changes
npm version major

# minor update / new features
npm version update

# patch / bugfixes
npm version patch
```

## Publish Package

When you are ready to publish your plugin to [npm](https://www.npmjs.com/), make sure you have removed the `private` attribute from the [`package.json`](./package.json) file then run:

```
npm publish
```

If you are publishing a scoped plugin, i.e. `@username/homebridge-xxx` you will need to add `--access=public` to command the first time you publish.

#### Publishing Beta Versions

You can publish *beta* versions of your plugin for other users to test before you release it to everyone.

```bash
# create a new pre-release version (eg. 2.1.0-beta.1)
npm version prepatch --preid beta

# publish to @beta
npm publish --tag=beta
```

Users can then install the  *beta* version by appending `@beta` to the install command, for example:

```
sudo npm install -g homebridge-example-plugin@beta
```


## Configuration

This plugin supports an auto-lock option for Dwelo locks:

Push updates are enabled by default so Apple Home receives state changes after each Dwelo background poll. Most users should leave these defaults unchanged; the category and read-strategy settings are intended as troubleshooting escape hatches for rate limits or device-specific issues.

- `autoLockMinutes` (number): Minutes to wait after a lock becomes unlocked before automatically relocking. Default is `3`. Set to `0` to disable.
- `enablePushUpdates` (boolean): Poll Dwelo in the background and push changed states to Apple Home. Default is `true`.
- `statePollMs` (number): Shared background polling interval for push updates, in milliseconds. Default is `60000`; values below `10000` are raised to `10000`.
- `pushDeviceTypes` (array): Device categories that receive push-style HomeKit updates. Default is `["lock", "switch", "thermostat"]`. Remove categories to reduce or disable background polling.
- `onGetStrategy` (`"cached-first"`, `"always-live"`, or `"cache-only"`): Advanced HomeKit read behavior. Default is `"cached-first"`, which returns recent cached state and fetches Dwelo only when needed. Use `"always-live"` to fetch Dwelo on every HomeKit read, or `"cache-only"` to rely only on background push polling.
- `lockPollMs` (number): Deprecated backwards-compatible alias for `statePollMs` when `statePollMs` is not set.

This plugin also supports Dwelo thermostats discovered from your configured gateway:

- `thermostatDisplayUnits` (`"celsius"` or `"fahrenheit"`): HomeKit display unit for thermostats. Default is `"celsius"`.
- `exposeThermostatHumidity` (boolean): Expose thermostat humidity as a HomeKit humidity sensor. Default is `true`.
- `exposeThermostatBattery` (boolean): Expose thermostat battery state as a HomeKit battery service. Default is `true`.
- `logThermostatSensorInventory` (boolean): Log thermostat sensor names and sanitized values for debugging. Default is `false`.

Ensure the `pluginAlias` in `config.schema.json` matches `PLATFORM_NAME` in `src/settings.ts`.
