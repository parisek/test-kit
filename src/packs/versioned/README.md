# Versioned contracts

A component pack holds one contract set for each supported major version of its library (R13.42, vision layers rule 5).
This folder builds on the pack API in `src/packs`. All files are pure. They have no DOM and no file system access (R4.4).
Nothing runs by default. A project must select the pack (G3, R5.1).

## Parts

- `version.js`: `detectMajor({ version, source })` returns `detected` with the major, or `unknown` with a diagnostic. `bundleBannerVersion` and `lockfileVersion` turn a bundle banner or a parsed `package-lock.json` into that input.
- `sets.js`: `defineContractSet` validates one set. `selectContractSet` picks the set for a detected major. `defineVersionedPack` builds a pack from the sets of one library.
- `swiper.js`: the Swiper 12 and Swiper 14 sets and the pack `swiper`. Entry point `@parisek/test-kit/packs/swiper`.

## Version detection

`version` is an exact release string (`12.2.0`, `v14.3.0`, `14`) or a whole major number. `source` is `lockfile`, `bundle-banner` or `config`.
A range (`^12.0.0`), a tag (`latest`), a prerelease (`14.0.0-beta.2`), a bad source or a missing value gives `unknown`.
The code never guesses and never falls back to another major (R8.7, R8.9).
The caller reads the version. The project passes it in `context.versions[library]` as `{ version, source }`.

## Contract sets

A set has `library`, `major`, `owner`, `status`, `verifiedAgainst`, `sources`, `facts` and `contracts`.
`status` is `verified` or `placeholder`. A verified set names the release and the sources it was checked against.
A placeholder set runs every contract as `incomplete`, so it never passes.
Every set of one library must declare the same contract ids. A major cannot skip a contract, and the contract id stays stable across majors.

## Pack behaviour

`defineVersionedPack` makes one check `<library>-version` and one check for each contract id, `<library>-<contract id>`.
Every check is a component check. It needs `context.components` to list the library.
The version check records the set, the detected version and the source in an `info` finding. Every contract finding carries the same record in `evidence.contractSet`.
An unknown or unsupported version gives an `error` finding with `evidence.state: unknown`. Every check of the pack is then `missing`, and no contract runs (R8.7).

## Swiper

Input: JSON-like facts about the DOM (see the header of `swiper.js`). Contracts: `structure` and `active-slide`.
Verified on 2026-10-18 by reading the npm packages `swiper@12.2.0` and `swiper@14.3.0` (`shared/swiper-core.mjs`): the default class names, the `swiper-initialized` container class, and that only the active slide gets `swiper-slide-active`.
The class surface is the same in both releases. The two sets stay separate so that a later change in one major edits one set.
Swiper has no runtime version property in the source of either release. The pack reads the version from the lockfile or from the bundle banner, not from a page global.
Not built: the browser step that collects the DOM facts and the version, and the report fields for the record (R13.9). The record lives in finding evidence until a design needs more.
The owner of both sets is `test-kit`.
