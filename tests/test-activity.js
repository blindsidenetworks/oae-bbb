/*
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
var fs = require('fs');
var ShortId = require('shortid');

var AuthzUtil = require('oae-authz/lib/util');
var log = require('oae-logger').logger('test-activity');
var PreviewConstants = require('oae-preview-processor/lib/constants');
var RestAPI = require('oae-rest');
var RestContext = require('oae-rest/lib/model').RestContext;
var Sanitization = require('oae-util/lib/sanitization');
var TestsUtil = require('oae-tests');

var ActivityTestsUtil = require('oae-activity/lib/test/util');
var EmailTestsUtil = require('oae-email/lib/test/util');

describe('Meeting Activity', function() {

    // Rest contexts that can be used performing rest requests
    var anonymousCamRestContext = null;
    var camAdminRestContext = null;
    var globalAdminRestContext = null;

    var suitable_files = null;
    var suitable_sizes = null;

    /**
     * Function that will fill up the tenant admin and anymous rest context
     */
    before(function(callback) {
        // Fill up the anonymous cam rest context
        anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        // Fill up global admin rest context
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
        callback();
    });

    /**
     * Drain the email queue
     */
    beforeEach(function(callback) {
        EmailTestsUtil.clearEmailCollections(callback);
    });

    describe('Activity Entity Models', function() {

        describe('Meetings', function() {

            /**
             * Test that verifies the properties of the meeting entity
             */
            it('verify the meeting entity model contains the correct information', function(callback) {
                TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
                    var simon = _.values(users)[0];

                    RestAPI.Meetings.createMeeting(simon.restContext, 'Goats', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                        assert.ok(!err);
                        assert.ok(meeting);

                        // Simon should've received a meeting activity in his stream
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                            assert.ok(!err);
                            var entity = activityStream.items[0];
                            assert.equal(entity['oae:activityType'], 'meeting-create');
                            assert.equal(entity['verb'], 'create');

                            // Assert Simon is the actor.
                            assert.equal(entity.actor['oae:id'], simon.user.id);

                            // Assert the meeting is the object.
                            assert.equal(entity.object['oae:id'], meeting.id);
                            assert.equal(entity.object['oae:visibility'], meeting.visibility);
                            assert.equal(entity.object['oae:profilePath'], meeting.profilePath);
                            assert.equal(entity.object['displayName'], meeting.displayName);
                            callback();
                        });
                    });
                });
            });

            /**
             * Test that verifies the properties of the meeting entity when updating.
             */
            it('verify the meeting entity model contains the correct information when updating a meeting', function(callback) {
                TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
                    var simon = _.values(users)[0];

                    RestAPI.Meetings.createMeeting(simon.restContext, 'Bonobos', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                        assert.ok(!err);
                        assert.ok(meeting);

                        RestAPI.Meetings.updateMeeting(simon.restContext, meeting.id, {'displayName': 'Not bonobos'}, function(err, updatedMeeting) {
                            assert.ok(!err);

                            // Simon should've received two entries in his stream (1 create and 1 update)
                            ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                                assert.ok(!err);
                                var entity = activityStream.items[0];
                                assert.equal(entity['oae:activityType'], 'meeting-update');
                                assert.equal(entity['verb'], 'update');

                                // Assert Simon is the actor.
                                assert.equal(entity.actor['oae:id'], simon.user.id);

                                // Assert the meeting is the object.
                                assert.equal(entity.object['oae:id'], meeting.id);
                                assert.equal(entity.object['displayName'], 'Not bonobos');
                                assert.equal(entity.object['oae:profilePath'], meeting.profilePath);

                                RestAPI.Meetings.updateMeeting(simon.restContext, meeting.id, {'visibility': 'public'}, function(err, updatedMeeting) {
                                    assert.ok(!err);

                                    ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                                        assert.ok(!err);
                                        var entity = activityStream.items[0];
                                        assert.equal(entity['oae:activityType'], 'meeting-update-visibility');
                                        assert.equal(entity['verb'], 'update');
                                        callback();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        describe('Meeting messages', function() {

            /**
             * Test that verifies the properties of a meeting message
             */
            it('verify the meeting message entity model contains the correct information', function(callback) {
                TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users, simon, nico) {

                    RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                        assert.ok(!err);
                        assert.ok(meeting);

                        RestAPI.Meetings.createMessage(simon.restContext, meeting.id, 'My message', null, function(err, message) {
                            assert.ok(!err);
                            ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                                assert.ok(!err);
                                var entity = activityStream.items[0];
                                assert.equal(entity['oae:activityType'], 'meeting-message');
                                assert.equal(entity['verb'], 'post');
                                // Assert Simon is the actor
                                assert.equal(entity.actor['oae:id'], simon.user.id);

                                // Assert the meeting is the target
                                assert.equal(entity.target['oae:id'], meeting.id);
                                assert.equal(entity.target['displayName'], meeting.displayName);
                                assert.equal(entity.target['oae:profilePath'], meeting.profilePath);

                                // Assert the message is the object
                                assert.equal(entity.object['oae:id'], message.id);
                                assert.equal(entity.object['oae:messageBoxId'], message.messageBoxId);
                                assert.equal(entity.object['oae:threadKey'], message.threadKey);
                                assert.equal(entity.object['content'], message.body);
                                assert.equal(entity.object['published'], message.created);
                                assert.equal(entity.object['objectType'], 'meeting-message');
                                assert.equal(entity.object['id'], 'http://' + global.oaeTests.tenants.cam.host + '/api/meeting/' + meeting.id + '/messages/' + message.created);

                                // Nico replies
                                RestAPI.Meetings.createMessage(nico.restContext, meeting.id, 'A reply', message.created, function(err, nicosMessage) {
                                    assert.ok(!err);

                                    ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                                        assert.ok(!err);

                                        // The first item should still be a meeting-message.
                                        // The object and actor will now be collections rather than a single message/person
                                        var entity = activityStream.items[0];
                                        assert.equal(entity['oae:activityType'], 'meeting-message');

                                        // The object should be an oae:collection containing 2 messages (the original message and the reply)
                                        assert.equal(entity.object['objectType'], 'collection');
                                        assert.ok(entity.object['oae:collection']);
                                        assert.equal(entity.object['oae:collection'].length, 2);
                                        var originalMessage = _.find(entity.object['oae:collection'], function(activityMessage) { return activityMessage['oae:id'] === message.id; });
                                        assert.ok(originalMessage);
                                        assert.equal(originalMessage['oae:id'], message.id);
                                        assert.equal(originalMessage['content'], message.body);
                                        assert.equal(originalMessage['author']['oae:id'], simon.user.id);
                                        assert.equal(originalMessage['oae:tenant']['alias'], global.oaeTests.tenants.cam.alias);

                                        var reply = _.find(entity.object['oae:collection'], function(activityMessage) { return activityMessage['oae:id'] === nicosMessage.id; });
                                        assert.ok(reply);
                                        assert.equal(reply['oae:id'], nicosMessage.id);
                                        assert.equal(reply['oae:messageBoxId'], nicosMessage.messageBoxId);
                                        assert.equal(reply['oae:threadKey'], nicosMessage.threadKey);
                                        assert.equal(reply['oae:tenant']['alias'], global.oaeTests.tenants.cam.alias);
                                        assert.equal(reply['content'], nicosMessage.body);
                                        assert.equal(reply['published'], nicosMessage.created);
                                        assert.equal(reply['author']['oae:id'], nico.user.id);
                                        assert.ok(reply['inReplyTo']);
                                        assert.equal(reply['inReplyTo']['oae:id'], message.id);

                                        // Verify both actors are present
                                        assert.equal(entity.actor['objectType'], 'collection');
                                        var simonEntity = _.find(entity.actor['oae:collection'], function(userEntity) { return userEntity['oae:id'] === simon.user.id; });
                                        assert.ok(simonEntity);
                                        assert.equal(simonEntity['oae:id'], simon.user.id);
                                        assert.equal(simonEntity['oae:profilePath'], '/user/' + simon.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(simon.user.id).resourceId);

                                        var nicoEntity = _.find(entity.actor['oae:collection'], function(userEntity) { return userEntity['oae:id'] === nico.user.id; });
                                        assert.ok(nicoEntity);
                                        assert.equal(nicoEntity['oae:id'], nico.user.id);
                                        assert.equal(nicoEntity['oae:profilePath'], '/user/' + nico.user.tenant.alias + '/' + AuthzUtil.getResourceFromId(nico.user.id).resourceId);

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

    describe('Activity Routing', function() {

        /**
         * Test that verifies that a message activity is routed to the managers and recent contributers their notification stream of a private meeting item
         */
        it('verify message activity is routed to the managers and recent contributers notification stream of a private meeting', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 4, function(err, users, simon, nico, bert, stuart) {
                assert.ok(!err);

                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'private',  [nico.user.id], [bert.user.id, stuart.user.id], function(err, meeting) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMessage(bert.restContext, meeting.id, 'Message A', null, function(err, message) {
                        assert.ok(!err);

                        // Assert that the managers got it
                        ActivityTestsUtil.collectAndGetNotificationStream(simon.restContext, null, function(err, activityStream) {
                            assert.ok(!err);
                            assert.ok(_.find(activityStream.items, function(activity) { return (activity['oae:activityType'] === 'meeting-message'); }));

                            ActivityTestsUtil.collectAndGetNotificationStream(nico.restContext, null, function(err, activityStream) {
                                assert.ok(!err);
                                assert.ok(_.find(activityStream.items, function(activity) { return (activity['oae:activityType'] === 'meeting-message'); }));

                                // Create another message and assert that both the managers and the recent contributers get a notification
                                RestAPI.Meetings.createMessage(nico.restContext, meeting.id, 'Message A', null, function(err, message) {
                                    assert.ok(!err);

                                    // Because Bert made a message previously, he should get a notification as well
                                    ActivityTestsUtil.collectAndGetNotificationStream(bert.restContext, null, function(err, activityStream) {
                                        assert.ok(!err);
                                        var messageActivities = _.filter(activityStream.items, function(activity) { return (activity['oae:activityType'] === 'meeting-message'); });
                                        assert.ok(messageActivities.length, 2);

                                        // Sanity-check that the managers got it as well
                                        ActivityTestsUtil.collectAndGetNotificationStream(nico.restContext, null, function(err, activityStream) {
                                            assert.ok(!err);
                                            var messageActivities = _.filter(activityStream.items, function(activity) { return (activity['oae:activityType'] === 'meeting-message'); });
                                            assert.ok(messageActivities.length, 2);

                                            ActivityTestsUtil.collectAndGetNotificationStream(simon.restContext, null, function(err, activityStream) {
                                                assert.ok(!err);
                                                var messageActivities = _.filter(activityStream.items, function(activity) { return (activity['oae:activityType'] === 'meeting-message'); });
                                                assert.ok(messageActivities.length, 2);

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


    describe('Meeting Activities', function() {

        /**
         * Test that verifies when a meeting is updated, an activity is generated for the action
         */
        it('verify updating a meeting results in an activity being generated', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
                var simon = _.values(users)[0];

                // Create a meeting to share
                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting);

                    RestAPI.Meetings.updateMeeting(simon.restContext, meeting.id, {'displayName': 'Blah!'}, function(err, meetingProfile) {
                        assert.ok(!err);
                        assert.ok(meetingProfile);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-share activity is the newest one in the feed
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-update');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);

                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies when a meeting is shared, an activity is generated for the action
         */
        it('verify sharing a meeting results in an activity being generated', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users) {
                var simon = _.values(users)[0];
                var nico = _.values(users)[1];

                // Create a meeting to share
                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting);

                    // Simon shares the meeting with nicolaas
                    RestAPI.Meetings.shareMeeting(simon.restContext, meeting.id, [nico.user.id], function(err) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-share activity is the newest one in the feed
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-share');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);
                            assert.equal(activity.target['oae:id'], nico.user.id);

                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies when a user is added as a manager to a meeting, a share activity is generated
         */
        it('verify adding user by updating permissions of a meeting results in a share activity being generated', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users, simon, branden) {
                assert.ok(!err);

                // Create a meeting to share
                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting);

                    var memberUpdates = {};
                    memberUpdates[branden.user.id] = 'member';

                    // Simon shares the meeting with Branden
                    RestAPI.Meetings.updateMeetingMembers(simon.restContext, meeting.id, memberUpdates, function(err) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-share activity is the newest one in the feed
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-share');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);
                            assert.equal(activity.target['oae:id'], branden.user.id);

                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies when a user is being promoted to a manager in to a meeting, a meeting-update-member-role activity is generated
         */
        it('verify updating user role of a meeting results in a meeting-update-member-role activity being generated', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users, simon, branden) {
                assert.ok(!err);

                // Create a meeting with a member
                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, [branden.user.id], function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting);

                    // Simon promotes Branden to manager
                    var memberUpdates = {};
                    memberUpdates[branden.user.id] = 'manager';
                    RestAPI.Meetings.updateMeetingMembers(simon.restContext, meeting.id, memberUpdates, function(err) {
                        assert.ok(!err);

                        // Verify the meeting-update-member-role activity is present
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function(err, activityStream) {
                            assert.ok(!err);
                            ActivityTestsUtil.assertActivity(activityStream.items[0], 'meeting-update-member-role', 'update', simon.user.id, branden.user.id, meeting.id);
                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies when a user adds a meeting to their library, an activity is generated
         */
        it('verify adding a meeting to your library results in an meeting-ad-to-library activity being generated', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users) {
                var simon = _.values(users)[0];
                var nico = _.values(users)[1];

                // Create a meeting to share
                RestAPI.Meetings.createMeeting(simon.restContext, 'Something something discussworthy', 'Start discussing this sweet topic', 'loggedin', null, null, function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting);

                    // Nicolaas adds the meeting to his library
                    RestAPI.Meetings.shareMeeting(nico.restContext, meeting.id, [nico.user.id], function(err) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(nico.restContext, nico.user.id, null, function(err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-share activity is the newest one in the feed
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-add-to-library');
                            assert.equal(activity.actor['oae:id'], nico.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);

                            return callback();
                        });
                    });
                });
            });
        });
    });

    describe('Email', function() {

        /**
         * Test that verifies an email is sent to the meeting managers when someone posts a message, and that private users
         * are appropriately scrubbed.
         */
        it('verify meeting message email and privacy', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 3, function(err, users) {
                assert.ok(!err);

                var mrvisser = _.values(users)[0];
                var simong = _.values(users)[1];
                var nicolaas = _.values(users)[2];

                // Generate e-mail addresses
                mrvisser.user.email = TestsUtil.generateTestEmailAddress('mrvisser');
                simong.user.email = TestsUtil.generateTestEmailAddress('simong');

                // Simon is private and mrvisser is public
                var mrvisserUpdate = {'email': mrvisser.user.email};
                var simongUpdate = {
                    'email': simong.user.email,
                    'visibility': 'private',
                    'publicAlias': 'swappedFromPublicAlias'
                };

                // Update the users
                RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, mrvisserUpdate, function(err) {
                    assert.ok(!err);

                    RestAPI.User.updateUser(simong.restContext, simong.user.id, simongUpdate, function(err) {
                        assert.ok(!err);

                        // Create the meeting
                        RestAPI.Meetings.createMeeting(mrvisser.restContext, 'A talk', 'about computers', 'public', [], [], function(err, meeting) {
                            assert.ok(!err);

                            // Post a new message
                            RestAPI.Meetings.createMessage(simong.restContext, meeting.id, '<b>Nice meeting.</b>\n\nWould read again', null, function(err, simongMessage) {
                                assert.ok(!err);

                                EmailTestsUtil.collectAndFetchAllEmails(function(emails) {
                                    // There should be exactly one email, the one sent to mrvisser (manager of meeting receives meeting-message notification)
                                    assert.equal(emails.length, 1);

                                    var stringEmail = JSON.stringify(emails[0]);
                                    var email = emails[0];

                                    // Sanity check that the email is to mrvisser
                                    assert.equal(email.to[0].address, mrvisser.user.email);

                                    // Ensure that the subject of the email contains the poster's name
                                    assert.notEqual(email.subject.indexOf('swappedFromPublicAlias'), -1);

                                    // Ensure some data expected to be in the email is there
                                    assert.notEqual(stringEmail.indexOf(simong.restContext.hostHeader), -1);
                                    assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                    assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                    // Ensure simong's private info is nowhere to be found
                                    assert.equal(stringEmail.indexOf(simong.user.displayName), -1);
                                    assert.equal(stringEmail.indexOf(simong.user.email), -1);
                                    assert.equal(stringEmail.indexOf(simong.user.locale), -1);

                                    // The email should contain the public alias
                                    assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                                    // The message should have escaped the HTML content in the original message
                                    assert.strictEqual(stringEmail.indexOf('<b>Nice meeting.</b>'), -1);

                                    // The new line characters should've been converted into paragraphs
                                    assert.notEqual(stringEmail.indexOf('Would read again</p>'), -1);

                                    // Send a message as nicolaas and ensure the recent commenter, simong receives an email about it
                                    RestAPI.Meetings.createMessage(nicolaas.restContext, meeting.id, 'I have a computer, too', null, function(err, nicolaasMessage) {
                                        assert.ok(!err);

                                        EmailTestsUtil.collectAndFetchAllEmails(function(emails) {
                                            // There should be 2 emails this time, one to the manager and one to the recent commenter, simong
                                            assert.equal(emails.length, 2);

                                            var emailAddresses = [emails[0].to[0].address, emails[1].to[0].address];
                                            assert.ok(_.contains(emailAddresses, simong.user.email));
                                            assert.ok(_.contains(emailAddresses, mrvisser.user.email));
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

        /**
         * Test that verifies an email is sent to the members when a meeting is created, and that private users are
         * appropriately scrubbed.
         */
        it('verify meeting-create email and privacy', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users) {
                assert.ok(!err);

                var mrvisser = _.values(users)[0];
                var simong = _.values(users)[1];

                // Generate e-mail addresses
                mrvisser.user.email = TestsUtil.generateTestEmailAddress('mrvisser');
                simong.user.email = TestsUtil.generateTestEmailAddress('simong');

                // Simon is private and mrvisser is public
                var mrvisserUpdate = {'email': mrvisser.user.email};
                var simongUpdate = {
                    'email': simong.user.email,
                    'visibility': 'private',
                    'publicAlias': 'swappedFromPublicAlias'
                };

                // Update the users
                RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, mrvisserUpdate, function(err) {
                    assert.ok(!err);

                    RestAPI.User.updateUser(simong.restContext, simong.user.id, simongUpdate, function(err) {
                        assert.ok(!err);

                        // Create the link, sharing it with mrvisser during the creation step. We will ensure he gets an email about it
                        RestAPI.Meetings.createMeeting(simong.restContext, 'A talk', 'not about computers', 'public', [], [mrvisser.user.id], function(err, meeting) {
                            assert.ok(!err);

                            // Mrvisser should get an email, with simong's information scrubbed
                            EmailTestsUtil.collectAndFetchAllEmails(function(emails) {
                                // There should be exactly one email, the one sent to mrvisser
                                assert.equal(emails.length, 1);

                                var stringEmail = JSON.stringify(emails[0]);
                                var email = emails[0];

                                // Sanity check that the email is to mrvisser
                                assert.equal(email.to[0].address, mrvisser.user.email);

                                // Ensure some data expected to be in the email is there
                                assert.notEqual(stringEmail.indexOf(simong.restContext.hostHeader), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                // Ensure simong's private info is nowhere to be found
                                assert.equal(stringEmail.indexOf(simong.user.displayName), -1);
                                assert.equal(stringEmail.indexOf(simong.user.email), -1);
                                assert.equal(stringEmail.indexOf(simong.user.locale), -1);

                                // The email should contain the public alias
                                assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                                callback();
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies an email is sent to the target users when a meeting is shared, and that private users are
         * appropriately scrubbed.
         */
        it('verify meeting-share email and privacy', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, users) {
                assert.ok(!err);

                var mrvisser = _.values(users)[0];
                var simong = _.values(users)[1];

                // Generate e-mail addresses
                mrvisser.user.email = TestsUtil.generateTestEmailAddress('mrvisser');
                simong.user.email = TestsUtil.generateTestEmailAddress('simong');

                // Simon is private and mrvisser is public
                var mrvisserUpdate = {'email': mrvisser.user.email};
                var simongUpdate = {
                    'email': simong.user.email,
                    'visibility': 'private',
                    'publicAlias': 'swappedFromPublicAlias'
                };

                // Update the users
                RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, mrvisserUpdate, function(err) {
                    assert.ok(!err);

                    RestAPI.User.updateUser(simong.restContext, simong.user.id, simongUpdate, function(err) {
                        assert.ok(!err);

                        // Create the link, then share it with mrvisser. We will ensure that mrvisser gets the email about the share
                        RestAPI.Meetings.createMeeting(simong.restContext, 'A talk', 'about the moon', 'public', [], [], function(err, meeting) {
                            assert.ok(!err);

                            // Collect the createLink activity
                            EmailTestsUtil.collectAndFetchAllEmails(function(emails) {

                                RestAPI.Meetings.shareMeeting(simong.restContext, meeting.id, [mrvisser.user.id], function(err) {
                                    assert.ok(!err);

                                    // Mrvisser should get an email, with simong's information scrubbed
                                    EmailTestsUtil.collectAndFetchAllEmails(function(emails) {
                                        // There should be exactly one email, the one sent to mrvisser
                                        assert.equal(emails.length, 1);

                                        var stringEmail = JSON.stringify(emails[0]);
                                        var email = emails[0];

                                        // Sanity check that the email is to mrvisser
                                        assert.equal(email.to[0].address, mrvisser.user.email);

                                        // Ensure some data expected to be in the email is there
                                        assert.notEqual(stringEmail.indexOf(simong.restContext.hostHeader), -1);
                                        assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                        assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                        // Ensure simong's private info is nowhere to be found
                                        assert.equal(stringEmail.indexOf(simong.user.displayName), -1);
                                        assert.equal(stringEmail.indexOf(simong.user.email), -1);
                                        assert.equal(stringEmail.indexOf(simong.user.locale), -1);

                                        // The email should contain the public alias
                                        assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);
                                        callback();
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
