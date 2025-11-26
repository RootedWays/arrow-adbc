"use strict";
// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdbcInfoCode = void 0;
/** Standard ADBC Info Codes for getInfo. */
var AdbcInfoCode;
(function (AdbcInfoCode) {
    AdbcInfoCode[AdbcInfoCode["VendorName"] = 0] = "VendorName";
    AdbcInfoCode[AdbcInfoCode["VendorVersion"] = 1] = "VendorVersion";
    AdbcInfoCode[AdbcInfoCode["VendorArrowVersion"] = 2] = "VendorArrowVersion";
    AdbcInfoCode[AdbcInfoCode["DriverName"] = 3] = "DriverName";
    AdbcInfoCode[AdbcInfoCode["DriverVersion"] = 4] = "DriverVersion";
    AdbcInfoCode[AdbcInfoCode["DriverArrowVersion"] = 5] = "DriverArrowVersion";
})(AdbcInfoCode || (exports.AdbcInfoCode = AdbcInfoCode = {}));
