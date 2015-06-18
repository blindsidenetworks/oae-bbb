/*
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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
var fs = require('fs');

var ActivityConstants = require('oae-activity/lib/constants').ActivityConstants;
var ActivityTestsUtil = require('oae-activity/lib/test/util');
var RestAPI = require('oae-rest');
var RestContext = require('oae-rest/lib/model').RestContext;
var TestsUtil = require('oae-tests');

var MeetingsConstants = require('oae-bbb/lib/constants').MeetingsConstants;

describe('Meeting Push', function() {
    // Rest contexts that can be used performing rest requests
    var localAdminRestContext = null;

    /**
     * Function that will fill up the tenant admin and anymous rest contexts
     */
    before(function(callback) {
        localAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.localhost.host);
        callback();
    });

    describe('Authorization', function() {

        /**
         * Test that verifies registering for a feed goes through the proper authorization checks
         */
        it('verify signatures must be valid', function(callback) {
            TestsUtil.generateTestUsers(localAdminRestContext, 2, function(err, users, simong, branden) {
                assert.ok(!err);

                RestAPI.User.getMe(simong.restContext, function(err, simonFull) {
                    assert.ok(!err);

                    var data = {
                        'authentication': {
                            'userId': simonFull.id,
                            'tenantAlias': simonFull.tenant.alias,
                            'signature': simonFull.signature
                        },
                        'feeds': []
                    };

                    ActivityTestsUtil.getFullySetupPushClient(data, function(client) {

                        // Create a meeting and get its full profile so we have a signature that we can use to register for push notifications
                        RestAPI.Meetings.createMeeting(simong.restContext, 'displayName', 'description', 'public', [branden.user.id], null, function(err, meeting) {
                            assert.ok(!err);
                            RestAPI.Meetings.getMeeting(simong.restContext, meeting.id, function(err, meeting) {
                                assert.ok(!err);

                                // Ensure we get a 400 error with an invalid activity stream id
                                client.subscribe(meeting.id, null, meeting.signature, null, function(err) {
                                    assert.equal(err.code, 400);

                                    // Ensure we get a 400 error with a missing resource id
                                    client.subscribe(null, 'activity', meeting.signature, null, function(err) {
                                        assert.equal(err.code, 400);

                                        // Ensure we get a 400 error with an invalid token
                                        client.subscribe(meeting.id, 'activity', {'signature': meeting.signature.signature}, null, function(err) {
                                            assert.equal(err.code, 401);
                                            client.subscribe(meeting.id, 'activity', {'expires': meeting.signature.expires}, null, function(err) {
                                                assert.equal(err.code, 401);

                                                // Ensure we get a 401 error with an incorrect signature
                                                client.subscribe(meeting.id, 'activity', {'expires': Date.now() + 10000, 'signature': 'foo'}, null, function(err) {
                                                    assert.equal(err.code, 401);

                                                    // Simon should not be able to use a signature that was generated for Branden
                                                    RestAPI.Meetings.getMeeting(branden.restContext, meeting.id, function(err, meetingForBranden) {
                                                        assert.ok(!err);
                                                        client.subscribe(meeting.id, 'activity', meetingForBranden.signature, null, function(err) {
                                                            assert.equal(err.code, 401);

                                                            // Sanity check that a valid signature works
                                                            client.subscribe(meeting.id, 'activity', meeting.signature, null, function(err) {
                                                                assert.ok(!err);
                                                                return callback();
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    describe('Notifications', function() {

        /**
         * Creates 2 users: `Branden` and `Simon` who are both managers of a meeting. A websocket will be created
         * for the `Simon`-user which is both authenticated and registered for push notifications on the meeting.
         *
         * @param  {Function}       callback                Standard callback function
         * @param  {Object}         callback.contexts       An object that holds the context and user info for the created users
         * @param  {Meeting}     callback.meeting     The created meeting
         * @param  {Client}         callback.client         A websocket client that is authenticated for the `Simon`-user and is registered for push notificates on the created meeting
         * @throws {Error}                                  If anything goes wrong, an assertion error will be thrown
         */
        var setupFixture = function(callback) {
            TestsUtil.generateTestUsers(localAdminRestContext, 2, function(err, users, branden, simon) {
                assert.ok(!err);

                var contexts = {
                    'branden': branden,
                    'simon': simon
                };

                // Get the full profile so we have a signature to authenticate ourselves on the WS
                RestAPI.User.getMe(contexts['simon'].restContext, function(err, simonFull) {
                    assert.ok(!err);

                    // Create a meeting and get the full meeting profile so we have a signature that we can use to register for push notifications
                    RestAPI.Meetings.createMeeting(contexts['simon'].restContext, 'A file', 'A proper file', 'private', [contexts['branden'].user.id], [], function(err, meeting) {
                        assert.ok(!err);
                        RestAPI.Meetings.getMeeting(contexts['simon'].restContext, meeting.id, function(err, meeting) {
                            assert.ok(!err);

                            // Route and deliver activities
                            ActivityTestsUtil.collectAndGetActivityStream(contexts['simon'].restContext, null, null, function() {

                                // Register for some streams
                                var data = {
                                    'authentication': {
                                        'userId': contexts['simon'].user.id,
                                        'tenantAlias': simonFull.tenant.alias,
                                        'signature': simonFull.signature
                                    },
                                    'streams': [
                                        {
                                            'resourceId': meeting.id,
                                            'streamType': 'activity',
                                            'token': meeting.signature
                                        },
                                        {
                                            'resourceId': meeting.id,
                                            'streamType': 'message',
                                            'token': meeting.signature
                                        }
                                    ]
                                };

                                ActivityTestsUtil.getFullySetupPushClient(data, function(client) {
                                    callback(contexts, meeting, client);
                                });
                            });
                        });
                    });
                });
            });
        };

        /**
         * Test that verifies an update gets pushed out
         */
        it('verify updates trigger a push notification', function(callback) {
            setupFixture(function(contexts, meeting, client) {

                // Trigger an update
                RestAPI.Meetings.updateMeeting(contexts['branden'].restContext, meeting.id, {'displayName': 'Laaike whatevs'}, function(err) {
                    assert.ok(!err);
                });


                ActivityTestsUtil.waitForPushActivity(client, MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE, ActivityConstants.verbs.UPDATE, contexts['branden'].user.id, meeting.id, null, function(activity) {
                    // Verify the updated display name is present on the activity object
                    assert.equal(activity.object.displayName, 'Laaike whatevs');
                    return client.close(callback);
                });
            });
        });

        /**
         * Test that verifies a visibility update gets pushed out
         */
        it('verify visibility updates trigger a push notification', function(callback) {
            setupFixture(function(contexts, meeting, client) {

                // Trigger an update
                RestAPI.Meetings.updateMeeting(contexts['branden'].restContext, meeting.id, {'visibility': 'loggedin'}, function(err) {
                    assert.ok(!err);
                });

                ActivityTestsUtil.waitForPushActivity(client, MeetingsConstants.activity.ACTIVITY_MEETING_UPDATE_VISIBILITY, ActivityConstants.verbs.UPDATE, contexts['branden'].user.id, meeting.id, null, function(activity) {
                    // Verify the updated visibility setting is present on the activity object
                    assert.equal(activity.object.visibility, 'loggedin');
                    return client.close(callback);
                });
            });
        });

        /**
         * Test that verifies a new message gets pushed out
         */
        it('verify a new message triggers a push notification', function(callback) {
            setupFixture(function(contexts, meeting, client) {
                var meetingMessage = null;
                var activity = null;

                var _assertAndCallback = _.after(2, function() {
                    // Verify that we have access to the message body and createdBy property
                    assert.equal(activity.object.body, 'Cup a Soup');
                    assert.ok(_.isObject(activity.object.createdBy));
                    assert.equal(activity.object.createdBy.id, contexts['branden'].user.id);
                    return client.close(callback);
                });

                // Create a message
                RestAPI.Meetings.createMessage(contexts['branden'].restContext, meeting.id, 'Cup a Soup', null, function(err, _meetingMessage) {
                    assert.ok(!err);
                    meetingMessage = _meetingMessage;
                    return _assertAndCallback();
                });

                ActivityTestsUtil.waitForPushActivity(client, MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE, ActivityConstants.verbs.POST, contexts['branden'].user.id, null, meeting.id, function(_activity) {
                    activity = _activity;
                    return _assertAndCallback();
                });
            });
        });

        /**
         * Test that verifies a message author's profile gets scrubbed
         */
        it('verify a message author\'s profile gets scrubbed', function(callback) {
            setupFixture(function(contexts, meeting, client) {

                RestAPI.User.updateUser(contexts['branden'].restContext, contexts['branden'].user.id, {'visibility': 'private', 'publicAlias': 'Ma Baker'}, function(err) {
                    assert.ok(!err);

                    var meetingMessage = null;
                    var activity = null;

                    var _assertAndCallback = _.after(2, function() {
                        // Verify that we have access to the message body and createdBy property
                        assert.equal(activity.object.body, 'Cup a Soup');
                        assert.equal(activity.object.createdBy.visibility, 'private');
                        assert.equal(activity.object.createdBy.displayName, 'Ma Baker');
                        return client.close(callback);
                    });

                    // Create a message
                    RestAPI.Meetings.createMessage(contexts['branden'].restContext, meeting.id, 'Cup a Soup', null, function(err, _meetingMessage) {
                        assert.ok(!err);
                        meetingMessage = _meetingMessage;
                        return _assertAndCallback();
                    });

                    ActivityTestsUtil.waitForPushActivity(client, MeetingsConstants.activity.ACTIVITY_MEETING_MESSAGE, ActivityConstants.verbs.POST, contexts['branden'].user.id, null, meeting.id, function(_activity) {
                        activity = _activity;
                        return _assertAndCallback();
                    });
                });
            });
        });
    });
});
