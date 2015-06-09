/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 * 
 * http://opensource.org/licenses/ECL-2.0
 * 
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var log = require('oae-logger').logger('oae-bbb');
var Validator = require('oae-util/lib/validator').Validator;

var BBBConfig = require('oae-config').config('oae-bbb');

var getMeeting = module.exports.getMeeting = function(ctx, groupId, callback) {
    var validator = new Validator();
    validator.check(groupId, {'code': 400,'msg': 'An invalid group id was specified'}).isGroupId();
    if (valdiator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    var config = _getConfig(ctx.tenant().alias);

    // Construct/Sign the URL
    var url = config.url + '?key=' + key;

    return {'url': url};

};

var _getConfig = function(tenantAlias) {
    return {
        'url': BBBConfig.getValue(tenantAlias, 'bbb', 'url'),
        'url': BBBConfig.getValue(tenantAlias, 'bbb', 'secret')
    };
};
