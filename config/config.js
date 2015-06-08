/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var Fields = require('oae-config/lib/fields');

module.exports = {
    'title': 'OAE Big Blue Button Module',
    'bbb': {
        'name': 'Big Blue Button Configuration',
        'description': 'Configuration for Big Blue Button conferencing',
        'elements': {
            'enabled': new Fields.Bool('Enabled', 'Enable conferencing with Big Blue Button', false, {'suppress': true}),
            'url': new Fields.Text('URL', 'The URL of your Big Blue Button server (e.g., https://bn.bigbluebutton.org)', '', {'suppress': true}),
            'key': new Fields.Text('Key', 'Your Big Blue Button key', '', {'suppress': true}),
            'secret': new Fields.Text('Secret', 'Your Big Blue Button secret', '', {'suppress': true})
        }
    }
};
