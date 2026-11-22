/*
 * Copyright (c) 2023, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

module.exports = {
    // Standalone project: don't inherit the cartridge ESLint config from the repo root.
    root: true,
    extends: [require.resolve('@salesforce/pwa-kit-dev/configs/eslint')]
}
