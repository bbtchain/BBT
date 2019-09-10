/*---------------------------------------------------------------------------------------------
 *  Created by imfly on Wed Mar 14 2017 16:11:17
 *
 *  Copyright (c) 2017 DDN.link. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function callMethod(shared, call, args, cb) {
  if (typeof shared[call] !== "function") {
    return cb(`Function not found in module: ${call}`);
  }

  const callArgs = [args, cb];
  shared[call].apply(null, callArgs);
}

module.exports = {
  callMethod
};
