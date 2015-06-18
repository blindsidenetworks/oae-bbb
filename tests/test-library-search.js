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

var _ = require('underscore');
var assert = require('assert');

var RestAPI = require('oae-rest');
var SearchTestsUtil = require('oae-search/lib/test/util');
var TestsUtil = require('oae-tests');

describe('Meeting Library Search', function() {

    // REST contexts we can use to do REST requests
    var anonymousRestContext = null;
    var camAdminRestContext = null;

    before(function(callback) {
        anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        callback();
    });

    describe('Library search', function() {
        /**
         * A test that verifies a meeting library can be searched through
         */
        it('verify searching through a meeting library', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
                assert.ok(!err);
                var simong = _.values(users)[0];

                // Create 2 meetings
                var randomTextA = TestsUtil.generateRandomText(25);
                var randomTextB = TestsUtil.generateRandomText(25);
                RestAPI.Meetings.createMeeting(simong.restContext, randomTextA, randomTextA, 'public', null, null, function(err, meetingA) {
                    assert.ok(!err);
                    RestAPI.Meetings.createMeeting(simong.restContext, randomTextB, randomTextB, 'public', null, null, function(err, meetingB) {
                        assert.ok(!err);

                        // Ensure that the randomTextA meeting returns and scores better than randomTextB
                        SearchTestsUtil.searchAll(simong.restContext, 'meeting-library', [simong.user.id], {'q': randomTextA}, function(err, results) {
                            assert.ok(!err);
                            assert.ok(results.results);

                            var doc = results.results[0];
                            assert.ok(doc);
                            assert.equal(doc.id, meetingA.id);
                            assert.equal(doc.displayName, randomTextA);
                            assert.equal(doc.description, randomTextA);
                            callback();
                        });
                    });
                });
            });
        });
    });
});