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

var AuthzAPI = require('oae-authz');
var ConfigTestsUtil = require('oae-config/lib/test/util');
var LibraryAPI = require('oae-library');
var RestAPI = require('oae-rest');
var RestContext = require('oae-rest/lib/model').RestContext;
var RestUtil = require('oae-rest/lib/util');
var TestsUtil = require('oae-tests');

var MeetingsConfig = require('oae-config').config('oae-bbb');
var MeetingsDAO = require('oae-bbb/lib/internal/dao');
var MeetingsTestsUtil = require('oae-bbb/lib/test/util');

describe('Meetings', function() {

    var camAnonymousRestCtx = null;
    var camAdminRestCtx = null;

    beforeEach(function() {
        camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    });

    describe('Iterating all Meetings', function() {

        /**
         * Test that verifies created meetings appear in MeetingsDAO.iterateAll
         */
        it('verify newly created meeting is returned in iterateAll', function(callback) {
            // Create a user to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // Stores how many meetings were in the database before we created a new one
                var numMeetingsOrig = 0;

                // Count how many meetings we currently have in the database
                MeetingsDAO.iterateAll(null, 1000, function(meetingRows, done) {
                    if (meetingRows) {
                        numMeetingsOrig += meetingRows.length;
                    }
                    return done();
                }, function(err) {
                    assert.ok(!err);

                    // Create one new one, and ensure the new number of meetings is numMeetingsOrig + 1
                    RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                        assert.ok(!err);

                        var numMeetingsAfter = 0;
                        var hasNewMeeting = false;

                        // Count the meetings we have now, and ensure we iterate over the new meeting
                        MeetingsDAO.iterateAll(null, 1000, function(meetingRows, done) {
                            if (meetingRows) {
                                numMeetingsAfter += meetingRows.length;
                                _.each(meetingRows, function(meetingRow) {
                                    if (meetingRow.id === meeting.id) {
                                        hasNewMeeting = true;
                                    }
                                });
                            }
                            return done();
                        }, function(err) {
                            assert.ok(!err);
                            assert.strictEqual(numMeetingsOrig + 1, numMeetingsAfter);
                            assert.ok(hasNewMeeting);
                            return callback();
                        });
                    });
                });
            });
        });
    });

    describe('Creating Meetings', function() {

        /**
         * Test that verifies miscellaneous validation input when creating a meeting
         */
        it('verify create meeting validation', function(callback) {

            // Create a user to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // Verify cannot create meeting anonymously
                RestAPI.Meetings.createMeeting(camAnonymousRestCtx, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(err);
                    assert.equal(err.code, 401);

                    // Verify cannot create meeting with null displayName
                    RestAPI.Meetings.createMeeting(user.restContext, null, description, visibility, null, null, function(err, meeting) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Verify with a displayName that is longer than the maximum allowed size
                        var longDisplayName = TestsUtil.generateRandomText(100);
                        RestAPI.Meetings.createMeeting(user.restContext, longDisplayName, description, visibility, null, null, function(err, meeting) {
                            assert.ok(err);
                            assert.equal(err.code, 400);
                            assert.ok(err.msg.indexOf('1000') > 0);

                            // Verify with a description that is longer than the maximum allowed size
                            var longDescription = TestsUtil.generateRandomText(1000);
                            RestAPI.Meetings.createMeeting(user.restContext, displayName, longDescription, visibility, null, null, function(err, meeting) {
                                assert.ok(err);
                                assert.equal(err.code, 400);
                                assert.ok(err.msg.indexOf('10000') > 0);

                                // Verify cannot create meeting with an empty description
                                RestAPI.Meetings.createMeeting(user.restContext, displayName, '', visibility, null, null, function(err, meeting) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);

                                    // Verify cannot create meeting with invalid visibility
                                    RestAPI.Meetings.createMeeting(user.restContext, displayName, description, 'not-a-visibility', null, null, function(err, meeting) {
                                        assert.ok(err);
                                        assert.equal(err.code, 400);

                                        // Verify cannot create meeting with an invalid manager id
                                        RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, ['not-an-id'], null, function(err, meeting) {
                                            assert.ok(err);
                                            assert.equal(err.code, 400);

                                            // Verify cannot create meeting with multiple invalid manager ids
                                            RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, ['not-an-id', 'another-one'], null, function(err, meeting) {
                                                assert.ok(err);
                                                assert.equal(err.code, 400);

                                                // Verify cannot create meeting with an invalid member id
                                                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, ['not-an-id'], function(err, meeting) {
                                                    assert.ok(err);
                                                    assert.equal(err.code, 400);

                                                    // Verify cannot create meeting with multiple invalid member ids
                                                    RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, ['not-an-id', 'another-one'], function(err, meeting) {
                                                        assert.ok(err);
                                                        assert.equal(err.code, 400);

                                                        // Verify that a valid meeting can be created
                                                        RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                                                            assert.ok(!err);
                                                            assert.ok(meeting);
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

        /**
         * Test that verifies a meeting is successfully created, with the proper meeting model and members model
         */
        it('verify successful meeting creation and model', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant) {
                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';
                var managers = [publicTenant.publicUser.user.id];
                var members = [publicTenant.loggedinUser.user.id];

                // Create the meeting whose model to verify
                RestAPI.Meetings.createMeeting(publicTenant.privateUser.restContext, displayName, description, visibility, managers, members, function(err, meeting) {
                    assert.ok(!err);
                    assert.ok(meeting.id);
                    assert.ok(meeting.createdBy, publicTenant.privateUser.user.id);
                    assert.equal(meeting.displayName, displayName);
                    assert.equal(meeting.description, description);
                    assert.equal(meeting.visibility, visibility);
                    assert.ok(meeting.created);
                    assert.ok(meeting.lastModified);
                    assert.ok(meeting.tenant);
                    assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                    assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);
                    return callback();
                });
            });
        });

        /**
         * Test that verifies that you cannot create a meeting when trying to add a private user as a member
         */
        it('verify create meeting with a private user as another member', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users) {
                assert.ok(!err);
                var nico = _.values(users)[0];
                var bert = _.values(users)[1];

                RestAPI.User.updateUser(bert.restContext, bert.user.id, {'visibility': 'private'}, function(err) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMeeting(nico.restContext, 'Test meeting', 'Test meeting description', 'public', [bert.user.id], [], function(err, meeting) {
                        assert.ok(err);
                        assert.equal(err.code, 400);
                        callback();
                    });
                });
            });
        });

        /**
         * Test that verifies that you cannot create a meeting when trying to add a private group as a member
         */
        it('verify create meeting with a private group as another member', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users) {
                assert.ok(!err);
                var nico = _.values(users)[0];
                var bert = _.values(users)[1];

                RestAPI.Group.createGroup(bert.restContext, 'Group title', 'Group description', 'private', undefined, [], [], function(err, groupObj) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMeeting(nico.restContext, 'Test meeting', 'Test meeting description', 'public', [groupObj.id], [], function(err, meeting) {
                        assert.ok(err);
                        assert.equal(err.code, 400);
                        callback();
                    });
                });
            });
        });
    });

    describe('Updating Meetings', function() {

        /**
         * Test that verifies miscellaneous validation of update meeting inputs
         */
        it('verify update meeting validation', function(callback) {
            var displayName = 'test-update-displayName';
            var description = 'test-update-description';
            var visibility = 'public';

            var updates = {
                'displayName': 'new-display-name',
                'description': 'new-description'
            };

            // Create a user to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                // Create a meeting that we'll try and update
                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, createdMeeting) {
                    assert.ok(!err);

                    // Verify not a valid meeting id
                    RestAPI.Meetings.updateMeeting(user.restContext, 'not-a-valid-id', updates, function(err, meeting) {
                        assert.ok(err);
                        assert.equal(err.code, 400);
                        assert.ok(!meeting);

                        // Verify no fields to update
                        RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {}, function(err, meeting) {
                            assert.ok(err);
                            assert.equal(err.code, 400);
                            assert.ok(!meeting);

                            // Verify invalid visibility value
                            RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {'visibility': 'not-a-visibility'}, function(err, meeting) {
                                assert.ok(err);
                                assert.equal(err.code, 400);
                                assert.ok(!meeting);

                                // Verify an invalid field name
                                RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {'not-a-valid-field': 'loggedin'}, function(err, meeting) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);
                                    assert.ok(!meeting);

                                    // Verify with a displayName that is longer than the maximum allowed size
                                    var longDisplayName = TestsUtil.generateRandomText(100);
                                    RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {'displayName': longDisplayName}, function(err, meeting) {
                                        assert.ok(err);
                                        assert.equal(err.code, 400);
                                        assert.ok(err.msg.indexOf('1000') > 0);
                                        assert.ok(!meeting);

                                        // Verify with a description that is longer than the maximum allowed size
                                        var longDescription = TestsUtil.generateRandomText(1000);
                                        RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {'description': longDescription}, function(err, meeting) {
                                            assert.ok(err);
                                            assert.equal(err.code, 400);
                                            assert.ok(err.msg.indexOf('10000') > 0);

                                            // Verify with an empty description
                                            RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, {'description': ''}, function(err, meeting) {
                                                assert.ok(err);
                                                assert.equal(err.code, 400);

                                                // Verify the meeting has not changed
                                                RestAPI.Meetings.getMeeting(user.restContext, createdMeeting.id, function(err, meetingProfile) {
                                                    assert.ok(!err);
                                                    assert.equal(meetingProfile.displayName, displayName);
                                                    assert.equal(meetingProfile.description, description);
                                                    assert.equal(meetingProfile.visibility, visibility);
                                                    assert.equal(meetingProfile.created, meetingProfile.lastModified);

                                                    // Now do a real update as a sanity check
                                                    RestAPI.Meetings.updateMeeting(user.restContext, createdMeeting.id, updates, function(err, meeting) {
                                                        assert.ok(!err);
                                                        assert.equal(meeting.displayName, updates.displayName);
                                                        assert.equal(meeting.description, updates.description);
                                                        assert.ok(meeting.canShare);
                                                        assert.ok(meeting.isManager);
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

        /**
         * Test that verifies a meeting can be updated and its model data
         */
        it('verify meeting update and model', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant) {
                var displayName = 'test-update-displayName';
                var description = 'test-update-description';
                var visibility = 'public';
                var managers = [publicTenant.publicUser.user.id];
                var members = [publicTenant.loggedinUser.user.id];

                // Create the meeting whose model to verify
                RestAPI.Meetings.createMeeting(publicTenant.adminRestContext, displayName, description, visibility, managers, members, function(err, meeting) {
                    assert.ok(!err);

                    // Update the meeting displayName, description and visibility with the manager user
                    var updates = {
                        'displayName': 'new-display-name',
                        'description': 'new-description'
                    };

                    // Verify the returned meeting model with a partial update.
                    RestAPI.Meetings.updateMeeting(publicTenant.publicUser.restContext, meeting.id, updates, function(err, meeting) {
                        assert.ok(!err);
                        assert.ok(meeting.id);
                        assert.equal(meeting.displayName, updates.displayName);
                        assert.equal(meeting.description, updates.description);
                        assert.equal(meeting.visibility, 'public');
                        assert.ok(parseInt(meeting.created, 10) < parseInt(meeting.lastModified, 10));
                        assert.ok(meeting.created);
                        assert.ok(meeting.lastModified);
                        assert.ok(meeting.tenant);
                        assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                        assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                        // Verify updating just the visibility
                        RestAPI.Meetings.updateMeeting(publicTenant.publicUser.restContext, meeting.id, {'visibility': 'private'}, function(err, meeting) {
                            assert.ok(!err);
                            assert.ok(meeting.id);
                            assert.equal(meeting.displayName, updates.displayName);
                            assert.equal(meeting.description, updates.description);
                            assert.equal(meeting.visibility, 'private');
                            assert.ok(parseInt(meeting.created, 10) < parseInt(meeting.lastModified, 10));
                            assert.ok(meeting.created);
                            assert.ok(meeting.lastModified);
                            assert.ok(meeting.tenant);
                            assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                            assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);
                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies the permissions restrictions on updating meetings
         */
        it('verify unauthorized users cannot update meetings', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant) {
                var updates = {
                    'displayName': 'new-display-name',
                    'description': 'new-description',
                    'visibility': 'private'
                };

                // Verify anonymous user cannot update
                RestAPI.Meetings.updateMeeting(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, updates, function(err, meeting) {
                    assert.ok(err);
                    assert.equal(err.code, 401);
                    assert.ok(!meeting);

                    // Verify loggedin non-member cannot update
                    RestAPI.Meetings.updateMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, updates, function(err, meeting) {
                        assert.ok(err);
                        assert.equal(err.code, 401);
                        assert.ok(!meeting);

                        // Verify member cannot update
                        RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.publicMeeting.id, [publicTenant.publicUser.user.id], function(err) {
                            assert.ok(!err);

                            RestAPI.Meetings.updateMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, updates, function(err, meeting) {
                                assert.ok(err);
                                assert.equal(err.code, 401);
                                assert.ok(!meeting);

                                // Verify the meeting is still the same
                                RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                    assert.ok(!err);
                                    assert.equal(meeting.displayName, publicTenant.publicMeeting.displayName);
                                    assert.equal(meeting.description, publicTenant.publicMeeting.description);
                                    assert.equal(meeting.visibility, publicTenant.publicMeeting.visibility);

                                    // Verify the manager can update
                                    var permissionChange = {};
                                    permissionChange[publicTenant.publicUser.user.id] = 'manager';
                                    RestAPI.Meetings.updateMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, permissionChange, function(err) {
                                        assert.ok(!err);

                                        RestAPI.Meetings.updateMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, updates, function(err, meeting) {
                                            assert.ok(!err);
                                            assert.ok(meeting);

                                            // Verify the meeting update took
                                            RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                                assert.ok(!err);
                                                assert.equal(meeting.displayName, updates.displayName);
                                                assert.equal(meeting.description, updates.description);
                                                assert.equal(meeting.visibility, updates.visibility);
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

    describe('Deleting Meetings', function() {

        /**
         * Test that verifies deleting a meeting properly cleans up library and authz
         * associations
         */
        it('verify deleting a meeting properly cleans up associations', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, users, branden) {
                assert.ok(!err);

                // Add two meetings. One is to delete and the other is to sanity check the library can still be rebuilt and contain the undeleted meeting
                RestAPI.Meetings.createMeeting(branden.restContext, 'name', 'descr', 'public', null, null, function(err, meeting) {
                    assert.ok(!err);
                    RestAPI.Meetings.createMeeting(branden.restContext, 'name2', 'descr2', 'public', null, null, function(err, meeting2) {

                        // First, do a sanity check that the meeting is in Branden's library
                        RestAPI.Meetings.getMeetingsLibrary(branden.restContext, branden.user.id, null, null, function(err, items) {
                            assert.ok(!err);
                            assert.equal(items.results.length, 2);

                            var itemIds = _.pluck(items.results, 'id');
                            assert.ok(_.contains(itemIds, meeting.id));
                            assert.ok(_.contains(itemIds, meeting2.id));

                            // Purge Branden's library and ensure they're both still there
                            LibraryAPI.Index.purge('meetings:meetings', branden.user.id, function(err) {
                                assert.ok(!err);
                                RestAPI.Meetings.getMeetingsLibrary(branden.restContext, branden.user.id, null, null, function(err, items) {
                                    assert.ok(!err);
                                    assert.equal(items.results.length, 2);

                                    // Delete one of the meetings
                                    RestAPI.Meetings.deleteMeeting(branden.restContext, meeting.id, function(err) {
                                        assert.ok(!err);

                                        // Ensure the meeting is removed from Branden's library
                                        RestAPI.Meetings.getMeetingsLibrary(branden.restContext, branden.user.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.equal(items.results.length, 1);
                                            assert.equal(items.results[0].id, meeting2.id);

                                            // Purge Branden's library and ensure the deleted one is not there. This ensures
                                            // the authz association does not have inconsistent association data
                                            LibraryAPI.Index.purge('meetings:meetings', branden.user.id, function(err) {
                                                assert.ok(!err);
                                                RestAPI.Meetings.getMeetingsLibrary(branden.restContext, branden.user.id, null, null, function(err, items) {
                                                    assert.ok(!err);
                                                    assert.equal(items.results.length, 1);
                                                    assert.strictEqual(items.results[0].id, meeting2.id);

                                                    // Sanity check the meeting is actually deleted
                                                    RestAPI.Meetings.getMeeting(branden.restContext, meeting.id, function(err, meeting) {
                                                        assert.equal(err.code, 404);
                                                        assert.ok(!meeting);
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

        /**
         * Test that verifies that only managers can delete a meeting
         */
        it('verify deleting a meeting', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users, branden, simon) {
                assert.ok(!err);

                // Add a meeting to try and delete
                RestAPI.Meetings.createMeeting(branden.restContext, 'name', 'descr', 'public', null, [simon.user.id], function(err, meeting) {
                    assert.ok(!err);

                    // Ensure the meeting can be fetched
                    RestAPI.Meetings.getMeeting(branden.restContext, meeting.id, function(err, fetchedMeeting) {
                        assert.ok(!err);
                        assert.ok(meeting);
                        assert.equal(fetchedMeeting.id, meeting.id);

                        // Verify Simon cannot delete the meeting (as he's not the manager)
                        RestAPI.Meetings.deleteMeeting(simon.restContext, meeting.id, function(err) {
                            assert.equal(err.code, 401);

                            // Ensure the meeting can still be fetched
                            RestAPI.Meetings.getMeeting(branden.restContext, meeting.id, function(err, fetchedMeeting) {
                                assert.ok(!err);
                                assert.ok(meeting);
                                assert.equal(fetchedMeeting.id, meeting.id);

                                // Ensure Branden can delete it
                                RestAPI.Meetings.deleteMeeting(branden.restContext, meeting.id, function(err) {
                                    assert.ok(!err);

                                    // Ensure the meeting can no longer be fetched
                                    RestAPI.Meetings.getMeeting(branden.restContext, meeting.id, function(err, meeting) {
                                        assert.equal(err.code, 404);
                                        assert.ok(!meeting);
                                        return callback();
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies some basic parameter validation when deleting a meeting.
         */
        it('verify deleting meeting validation', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, users) {
                assert.ok(!err);
                var branden = _.values(users)[0];

                // An invalid meeting id, should result in a  400.
                RestAPI.Meetings.deleteMeeting(branden.restContext, 'invalid id', function(err) {
                    assert.equal(err.code, 400);

                     // A non-existing meeting should result in a 404
                    RestAPI.Meetings.deleteMeeting(branden.restContext, 'd:camtest:bleh', function(err) {
                        assert.equal(err.code, 404);
                        callback();
                    });
                });
            });
        });
    });

    describe('Meetings Model', function() {

        /**
         * Test that verifies the full profile model of a meeting, and the privacy rules for its access.
         */
        it('verify meeting full profile model, privacy and validation', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
                var displayName = 'test-fullprofile-displayName';
                var description = 'test-fullprofile-description';
                var visibility = 'public';

                ////////////////////////////////
                // ANONYMOUS SAME-TENANT USER //
                ////////////////////////////////

                // Ensure getMeeting validation
                RestAPI.Meetings.getMeeting(publicTenant.anonymousRestContext, 'not-a-valid-id', function(err) {
                    assert.ok(err);
                    assert.equal(err.code, 400);

                    // Ensure anonymous user cannot see the full profile of loggedin and private
                    RestAPI.Meetings.getMeeting(publicTenant.anonymousRestContext, publicTenant.privateMeeting.id, function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 401);

                        RestAPI.Meetings.getMeeting(publicTenant.anonymousRestContext, publicTenant.loggedinMeeting.id, function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 401);

                            // Verify they can see public
                            RestAPI.Meetings.getMeeting(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                assert.ok(!err);

                                // Basic info
                                assert.equal(meeting.id, meeting.id);
                                assert.equal(meeting.displayName, meeting.displayName);
                                assert.equal(meeting.description, meeting.description);
                                assert.equal(meeting.visibility, meeting.visibility);
                                assert.equal(meeting.created, meeting.lastModified);
                                assert.equal(meeting.created, meeting.created);
                                assert.ok(meeting.tenant);
                                assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                // Access info
                                assert.ok(!meeting.isManager);
                                assert.ok(!meeting.canShare);



                                ///////////////////////////////
                                // LOGGEDIN SAME-TENANT USER //
                                ///////////////////////////////

                                // Ensure loggedin user cannot see the full profile of private
                                RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, publicTenant.privateMeeting.id, function(err) {
                                    assert.ok(err);
                                    assert.equal(err.code, 401);

                                    // Loggedin user can see the profile of logged, and they can post and share on it
                                    RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, function(err, meeting) {
                                        assert.ok(!err);

                                        // Basic info
                                        assert.equal(meeting.id, meeting.id);
                                        assert.equal(meeting.displayName, meeting.displayName);
                                        assert.equal(meeting.description, meeting.description);
                                        assert.equal(meeting.visibility, meeting.visibility);
                                        assert.equal(meeting.created, meeting.lastModified);
                                        assert.equal(meeting.created, meeting.created);
                                        assert.ok(meeting.tenant);
                                        assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                        assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                        // Access info
                                        assert.ok(!meeting.isManager);
                                        assert.ok(meeting.canShare);

                                        // Verify they can see, share, post on public
                                        RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                            assert.ok(!err);

                                            // Basic info
                                            assert.equal(meeting.id, meeting.id);
                                            assert.equal(meeting.displayName, meeting.displayName);
                                            assert.equal(meeting.description, meeting.description);
                                            assert.equal(meeting.visibility, meeting.visibility);
                                            assert.equal(meeting.created, meeting.lastModified);
                                            assert.equal(meeting.created, meeting.created);
                                            assert.ok(meeting.tenant);
                                            assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                            assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                            // Access info
                                            assert.ok(!meeting.isManager);
                                            assert.ok(meeting.canShare);


                                            ////////////////////////
                                            // MEMBER SAME-TENANT //
                                            ////////////////////////

                                            // Share private meeting with the loggedin user
                                            RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.privateMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                                                assert.ok(!err);

                                                // Loggedin user can now view, and post on meeting, but still cannot share
                                                RestAPI.Meetings.getMeeting(publicTenant.loggedinUser.restContext, publicTenant.privateMeeting.id, function(err, meeting) {
                                                    assert.ok(!err);

                                                    // Basic info
                                                    assert.equal(meeting.id, meeting.id);
                                                    assert.equal(meeting.displayName, meeting.displayName);
                                                    assert.equal(meeting.description, meeting.description);
                                                    assert.equal(meeting.visibility, meeting.visibility);
                                                    assert.equal(meeting.created, meeting.lastModified);
                                                    assert.equal(meeting.created, meeting.created);
                                                    assert.ok(meeting.tenant);
                                                    assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                                    assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                                    // Access info
                                                    assert.ok(!meeting.isManager);
                                                    assert.ok(!meeting.canShare);


                                                    /////////////////////////
                                                    // MANAGER SAME-TENANT //
                                                    /////////////////////////

                                                    // Make public user manager
                                                    var permissionChanges = {};
                                                    permissionChanges[publicTenant.loggedinUser.user.id] = 'manager';
                                                    RestAPI.Meetings.updateMeetingMembers(publicTenant.adminRestContext, publicTenant.privateMeeting.id, permissionChanges, function(err) {
                                                        assert.ok(!err);

                                                        // Loggedin user can now view, share, and post on private meeting
                                                        RestAPI.Meetings.getMeeting(publicTenant.loggedinUser.restContext, publicTenant.privateMeeting.id, function(err, meeting) {
                                                            assert.ok(!err);

                                                            // Basic info
                                                            assert.equal(meeting.id, meeting.id);
                                                            assert.equal(meeting.displayName, meeting.displayName);
                                                            assert.equal(meeting.description, meeting.description);
                                                            assert.equal(meeting.visibility, meeting.visibility);
                                                            assert.equal(meeting.created, meeting.lastModified);
                                                            assert.equal(meeting.created, meeting.created);
                                                            assert.ok(meeting.tenant);
                                                            assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                                            assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                                            // Access info
                                                            assert.ok(meeting.isManager);
                                                            assert.ok(meeting.canShare);


                                                            ////////////////////////////////////////////
                                                            // ADMIN USER FROM EXTERNAL PUBLIC TENANT //
                                                            ////////////////////////////////////////////

                                                            // Ensure cross-tenant user cannot see the full profile of loggedin and private
                                                            RestAPI.Meetings.getMeeting(publicTenant1.adminRestContext, publicTenant.privateMeeting.id, function(err) {
                                                                assert.ok(err);
                                                                assert.equal(err.code, 401);

                                                                RestAPI.Meetings.getMeeting(publicTenant1.adminRestContext, publicTenant.loggedinMeeting.id, function(err) {
                                                                    assert.ok(err);
                                                                    assert.equal(err.code, 401);

                                                                    // Verify they can see, share and post on public meetings (both are public tenants)
                                                                    RestAPI.Meetings.getMeeting(publicTenant1.adminRestContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                                                        assert.ok(!err);

                                                                        // Basic info
                                                                        assert.equal(meeting.id, meeting.id);
                                                                        assert.equal(meeting.displayName, meeting.displayName);
                                                                        assert.equal(meeting.description, meeting.description);
                                                                        assert.equal(meeting.visibility, meeting.visibility);
                                                                        assert.equal(meeting.created, meeting.lastModified);
                                                                        assert.equal(meeting.created, meeting.created);
                                                                        assert.ok(meeting.tenant);
                                                                        assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                                                        assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                                                        // Access info
                                                                        assert.ok(!meeting.isManager);
                                                                        assert.ok(meeting.canShare);


                                                                        /////////////////////////////////////////////
                                                                        // ADMIN USER FROM EXTERNAL PRIVATE TENANT //
                                                                        /////////////////////////////////////////////

                                                                        // Ensure cross-tenant user cannot see the full profile of loggedin and private
                                                                        RestAPI.Meetings.getMeeting(privateTenant1.adminRestContext, publicTenant.privateMeeting.id, function(err) {
                                                                            assert.ok(err);
                                                                            assert.equal(err.code, 401);

                                                                            RestAPI.Meetings.getMeeting(privateTenant1.adminRestContext, publicTenant.loggedinMeeting.id, function(err) {
                                                                                assert.ok(err);
                                                                                assert.equal(err.code, 401);

                                                                                // Verify they can see the public meeting, but cannot post or share because the tenant is private
                                                                                RestAPI.Meetings.getMeeting(privateTenant1.adminRestContext, publicTenant.publicMeeting.id, function(err, meeting) {
                                                                                    assert.ok(!err);

                                                                                    // Basic info
                                                                                    assert.equal(meeting.id, meeting.id);
                                                                                    assert.equal(meeting.displayName, meeting.displayName);
                                                                                    assert.equal(meeting.description, meeting.description);
                                                                                    assert.equal(meeting.visibility, meeting.visibility);
                                                                                    assert.equal(meeting.created, meeting.lastModified);
                                                                                    assert.equal(meeting.created, meeting.created);
                                                                                    assert.ok(meeting.tenant);
                                                                                    assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                                                                                    assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);

                                                                                    // Access info
                                                                                    assert.ok(!meeting.isManager);
                                                                                    assert.ok(!meeting.canShare);

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
                    });
                });
            });
        });

        /**
         * Test that verifies just the `createdBy` field of the full meeting profile. Verifies it gets scrubbed appropriately due to user profile
         * visibility restrictions.
         */
        it('verify meeting full profile createdBy model and privacy', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
                var displayName = 'test-createdBy-displayName';
                var description = 'test-createdBy-description';
                var visibility = 'public';

                // Create the meeting whose createdBy model to verify
                RestAPI.Meetings.createMeeting(publicTenant.loggedinUser.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Verify anonymous user gets a scrubbed createdBy object
                    RestAPI.Meetings.getMeeting(publicTenant.anonymousRestContext, meeting.id, function(err, meeting) {
                        assert.ok(!err);

                        // Display name should have been swapped out for the publicAlias
                        assert.ok(meeting.createdBy);
                        assert.equal(meeting.createdBy.id, publicTenant.loggedinUser.user.id);
                        assert.equal(meeting.createdBy.displayName, publicTenant.loggedinUser.user.publicAlias);

                        // Verify authenticated user gets a full createdBy object
                        RestAPI.Meetings.getMeeting(publicTenant.publicUser.restContext, meeting.id, function(err, meeting) {
                            assert.ok(!err);

                            assert.ok(meeting.createdBy);
                            assert.equal(meeting.createdBy.id, publicTenant.loggedinUser.user.id);
                            assert.equal(meeting.createdBy.tenant.alias, publicTenant.tenant.alias);
                            assert.equal(meeting.createdBy.tenant.displayName, publicTenant.tenant.displayName);
                            assert.equal(meeting.createdBy.displayName, publicTenant.loggedinUser.user.displayName);
                            assert.ok(!meeting.createdBy.publicAlias);
                            assert.equal(meeting.createdBy.visibility, publicTenant.loggedinUser.user.visibility);
                            assert.equal(meeting.createdBy.resourceType, 'user');
                            return callback();
                        });
                    });
                });
            });
        });
    });

    describe('Meetings Members', function() {

        /**
         * Verify the model of the meetings member listing, and the privacy rules associated to its access, and the access of
         * data associated to users and groups inside of it.
         */
        it('verify meeting members list model, privacy and validation', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
                var displayName = 'test-membersprivacy-displayName';
                var description = 'test-membersprivacy-description';
                var visibility = 'public';

                // Share public meeting with loggedin and private user
                var members = [publicTenant.loggedinUser.user.id, publicTenant.privateUser.user.id];
                RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.publicMeeting.id, members, function(err) {
                    assert.ok(!err);

                    // Verify validation getting meeting members
                    RestAPI.Meetings.getMeetingMembers(publicTenant.anonymousRestContext, 'not-a-valid-id', null, null, function(err, members) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Verify anonymous user gets a scrubbed member for loggedin and private member
                        RestAPI.Meetings.getMeetingMembers(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, null, null, function(err, members) {
                            assert.ok(!err);
                            assert.equal(members.results.length, 3);

                            var hadLoggedinUser = false;
                            var hadPublicUser = false;

                            // Verify the members model
                            _.each(members.results, function(member) {
                                if (member.profile.id === publicTenant.loggedinUser.user.id) {
                                    hadPublicUser = true;
                                    assert.equal(member.role, 'member');
                                    assert.equal(member.profile.tenant.alias, publicTenant.tenant.alias);
                                    assert.equal(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                                    assert.equal(member.profile.displayName, publicTenant.loggedinUser.user.publicAlias);
                                    assert.equal(member.profile.visibility, publicTenant.loggedinUser.user.visibility);
                                    assert.ok(!member.profile.profilePath);
                                    assert.ok(!member.profile.publicAlias);
                                    assert.equal(member.profile.resourceType, 'user');
                                } else if (member.profile.id === publicTenant.privateUser.user.id) {
                                    hadLoggedinUser = true;
                                    assert.equal(member.role, 'member');
                                    assert.equal(member.profile.tenant.alias, publicTenant.tenant.alias);
                                    assert.equal(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                                    assert.equal(member.profile.displayName, publicTenant.privateUser.user.publicAlias);
                                    assert.equal(member.profile.visibility, publicTenant.privateUser.user.visibility);
                                    assert.ok(!member.profile.profilePath);
                                    assert.ok(!member.profile.publicAlias);
                                    assert.equal(member.profile.resourceType, 'user');
                                } else {
                                    // Admin user
                                    assert.equal(member.role, 'manager');
                                }
                            });


                            // Verify authenticated user gets a scrubbed member for private member, but full loggedin user profile
                            RestAPI.Meetings.getMeetingMembers(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, null, null, function(err, members) {
                                assert.ok(!err);
                                assert.equal(members.results.length, 3);

                                var hadLoggedinUser = false;
                                var hadPublicUser = false;

                                // Verify the members model
                                _.each(members.results, function(member) {
                                    if (member.profile.id === publicTenant.loggedinUser.user.id) {
                                        hadPublicUser = true;
                                        assert.equal(member.role, 'member');
                                        assert.equal(member.profile.tenant.alias, publicTenant.tenant.alias);
                                        assert.equal(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                                        assert.equal(member.profile.displayName, publicTenant.loggedinUser.user.displayName);
                                        assert.equal(member.profile.visibility, publicTenant.loggedinUser.user.visibility);
                                        assert.ok(member.profile.profilePath);
                                        assert.ok(!member.profile.publicAlias);
                                        assert.equal(member.profile.resourceType, 'user');
                                    } else if (member.profile.id === publicTenant.privateUser.user.id) {
                                        hadLoggedinUser = true;
                                        assert.equal(member.role, 'member');
                                        assert.equal(member.profile.tenant.alias, publicTenant.tenant.alias);
                                        assert.equal(member.profile.tenant.displayName, publicTenant.tenant.displayName);
                                        assert.equal(member.profile.displayName, publicTenant.privateUser.user.publicAlias);
                                        assert.equal(member.profile.visibility, publicTenant.privateUser.user.visibility);
                                        assert.ok(!member.profile.profilePath);
                                        assert.ok(!member.profile.publicAlias);
                                        assert.equal(member.profile.resourceType, 'user');
                                    } else {
                                        // Admin user
                                        assert.equal(member.role, 'manager');
                                    }
                                });

                                return callback();
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies meeting members can be paged
         */
        it('verify paging meeting members', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 10, function(err, users) {
                assert.ok(!err);
                var simon = _.values(users)[0];

                // Get the user ids for the users we'll add as members
                var members = _.filter(_.values(users), function(user) { return user.user.id !== simon.user.id; });
                var memberIds = [];
                _.each(members, function(user) {
                    memberIds.push(user.user.id);
                });

                RestAPI.Meetings.createMeeting(simon.restContext, 'displayName', 'description', 'public', null, memberIds, function(err, meeting) {
                    assert.ok(!err);

                    // Get the first 3 members
                    RestAPI.Meetings.getMeetingMembers(simon.restContext, meeting.id, null, 3, function(err, members) {
                        assert.ok(!err);
                        assert.equal(members.results.length, 3);
                        assert.ok(members.nextToken);

                        var seenMembers = [];
                        _.each(members.results, function(member) { seenMembers.push(member.profile.id); });

                        // Get the next 3 members
                        RestAPI.Meetings.getMeetingMembers(simon.restContext, meeting.id, members.nextToken, 3, function(err, members) {
                            assert.ok(!err);
                            assert.equal(members.results.length, 3);
                            assert.ok(members.nextToken);

                            // Verify we haven't seen any of these members
                            _.each(members.results, function(member) {
                                assert.ok(!_.contains(seenMembers, member.profile.id));
                            });

                            // Add these set of members to the 'seen' members list
                            _.each(members.results, function(member) { seenMembers.push(member.profile.id); });

                            // Get another page of members
                            RestAPI.Meetings.getMeetingMembers(simon.restContext, meeting.id, members.nextToken, 3, function(err, members) {
                                assert.ok(!err);
                                assert.equal(members.results.length, 3);
                                assert.ok(members.nextToken);

                                // Verify we haven't seen any of these members
                                _.each(members.results, function(member) {
                                    assert.ok(!_.contains(seenMembers, member.profile.id));
                                });

                                // Add these set of members to the 'seen' members list
                                _.each(members.results, function(member) { seenMembers.push(member.profile.id); });

                                // Get the last member
                                RestAPI.Meetings.getMeetingMembers(simon.restContext, meeting.id, members.nextToken, 3, function(err, members) {
                                    assert.ok(!err);
                                    assert.equal(members.results.length, 1);

                                    // There are no further results, nextToken should be null
                                    assert.ok(!members.nextToken);
                                    callback();
                                });
                            });
                        });
                    });
                });

            });
        });

        /**
         * Test that verifies that you cannot add a private user as a member
         */
        it('verify adding a private user as a member is not possible', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users) {
                assert.ok(!err);
                var nico = _.values(users)[0];
                var bert = _.values(users)[1];

                RestAPI.User.updateUser(bert.restContext, bert.user.id, {'visibility': 'private'}, function(err) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMeeting(nico.restContext, 'Test meeting', 'Test meeting description', 'public', [], [], function(err, meeting) {
                        assert.ok(!err);

                        var update = {};
                        update[bert.user.id] = 'manager';
                        RestAPI.Meetings.updateMeetingMembers(nico.restContext, meeting.id, update, function(err) {
                            assert.equal(err.code, 400);
                            callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies that you cannot add a private group as a member
         */
        it('verify adding a private group as a member is not possible', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users) {
                assert.ok(!err);
                var nico = _.values(users)[0];
                var bert = _.values(users)[1];

                RestAPI.Group.createGroup(bert.restContext, 'Group title', 'Group description', 'private', undefined, [], [], function(err, groupObj) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMeeting(nico.restContext, 'Test meeting', 'Test meeting description', 'public', [], [], function(err, meeting) {
                        assert.ok(!err);

                        var update = {};
                        update[groupObj.id] = 'manager';
                        RestAPI.Meetings.updateMeetingMembers(nico.restContext, meeting.id, update, function(err) {
                            assert.equal(err.code, 400);
                            callback();
                        });
                    });
                });
            });
        });
    });

    describe('Meetings Library', function() {

        /*!
         * Verify that the set of meeting library results has the item with id `id`
         *
         * @param  {Message[]}  results         The array of messages to check
         * @param  {String}     id              The id to search for in the messages
         * @throws {Error}                      Throws an assertion error if the id is not in the list of messages
         */
        var _assertContainsItem = function(results, id) {
            var hasItem = false;
            _.each(results, function(item) {
                if (item.id === id) {
                    hasItem = true;
                }
            });

            assert.ok(hasItem);
        };

        /*!
         * Verify that the set of meeting library results does not have the item with id `id`
         *
         * @param  {Message[]}  results         The array of messages to check
         * @param  {String}     id              The id to search for in the messages
         * @throws {Error}                      Throws an assertion error if the id is in the list of messages
         */
        var _assertDoesNotContainItem = function(results, id) {
            _.each(results, function(item) {
                assert.notEqual(item.id, id);
            });
        };

        /**
         * Test that verifies the validation of listing a meeting library
         */
        it('verify validation when listing meeting library', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                RestAPI.Meetings.getMeetingsLibrary(user.restContext, 'not-a-valid-id', null, null, function(err, items) {
                    assert.ok(err);
                    assert.equal(err.code, 400);

                    RestAPI.Meetings.getMeetingsLibrary(user.restContext, user.user.id, null, null, function(err, items) {
                        assert.ok(!err);
                        return callback();
                    });
                });
            });
        });

        /**
         * Verify the model of meetings that appear in the meeting libraries
         */
        it('verify meeting library model', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                // Share an item with the public user
                RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.publicMeeting.id, [publicTenant.publicUser.user.id], function(err) {
                    assert.ok(!err);

                    // Get and verify the model in the public user's library
                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                        assert.ok(!err);
                        assert.equal(items.results.length, 1);
                        assert.ok(!items.nextToken);

                        var meeting = items.results[0];
                        assert.equal(meeting.tenant.alias, publicTenant.tenant.alias);
                        assert.equal(meeting.tenant.displayName, publicTenant.tenant.displayName);
                        assert.equal(meeting.id, publicTenant.publicMeeting.id);
                        assert.equal(meeting.createdBy, publicTenant.publicMeeting.createdBy);
                        assert.equal(meeting.displayName, publicTenant.publicMeeting.displayName);
                        assert.equal(meeting.description, publicTenant.publicMeeting.description);
                        assert.equal(meeting.visibility, publicTenant.publicMeeting.visibility);
                        assert.equal(meeting.created, publicTenant.publicMeeting.created);
                        assert.ok(meeting.lastModified);
                        return callback();
                    });
                });
            });
        });

        /**
         * Verify the access privacy of meetings inside a meeting user library. Ensures meetings in libraries do not leak to users viewing
         * other user libraries.
         */
        it('verify meeting user library privacy', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
                // Make public user manager of the public meeting so it goes in their library
                var updatePermissions = {};
                updatePermissions[publicTenant.publicUser.user.id] = 'manager';
                MeetingsTestsUtil.assertUpdateMeetingMembersSucceeds(publicTenant.adminRestContext, publicTenant.publicMeeting.id, updatePermissions, function() {


                    //////////////////////////////////////////////////////
                    // VERIFY PUBLIC MEETING VISIBILITY IN LIBRARIES //
                    //////////////////////////////////////////////////////

                    // Verify anonymous user can see it
                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                        assert.ok(!err);
                        _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                        // Verify authenticated user can see it
                        RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                            assert.ok(!err);
                            _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                            // Verify own user can see it
                            RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                assert.ok(!err);
                                _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                // Verify cross-tenant user can see it
                                RestAPI.Meetings.getMeetingsLibrary(publicTenant1.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                    assert.ok(!err);
                                    _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                    // Verify cross-tenant anonymous can see it
                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant1.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                        assert.ok(!err);
                                        _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                        // Verify cross-tenant admin can see it
                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant1.adminRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            _assertContainsItem(items.results, publicTenant.publicMeeting.id);


                                            ////////////////////////////////////////////////////////
                                            // VERIFY LOGGEDIN MEETING VISIBILITY IN LIBRARIES //
                                            ////////////////////////////////////////////////////////

                                            MeetingsTestsUtil.assertUpdateMeetingSucceeds(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, {'visibility': 'loggedin'}, function() {

                                                // Verify anonymous user cannot see it
                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                    assert.ok(!err);
                                                    _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                    // Verify authenticated user can see it
                                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                        assert.ok(!err);
                                                        _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                                        // Verify own user can see it
                                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                            assert.ok(!err);
                                                            _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                                            // Verify cross-tenant user cannot see it
                                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant1.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                assert.ok(!err);
                                                                _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                                // Verify cross-tenant anonymous cannot see it
                                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant1.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                    assert.ok(!err);
                                                                    _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                                    // Verify cross-tenant admin cannot see it
                                                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant1.adminRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                        assert.ok(!err);
                                                                        _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);


                                                                        ///////////////////////////////////////////////////////
                                                                        // VERIFY PRIVATE MEETING VISIBILITY IN LIBRARIES //
                                                                        ///////////////////////////////////////////////////////

                                                                        MeetingsTestsUtil.assertUpdateMeetingSucceeds(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, {'visibility': 'private'}, function() {
                                                                            assert.ok(!err);

                                                                            // Verify anonymous user cannot see it
                                                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                assert.ok(!err);
                                                                                _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);
                                                                                // Verify authenticated user cannot see it
                                                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                    assert.ok(!err);
                                                                                    _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                                                    // Verify own user can see it
                                                                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                        assert.ok(!err);
                                                                                        _assertContainsItem(items.results, publicTenant.publicMeeting.id);
                                                                                        // Verify cross-tenant user cannot see it
                                                                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant1.publicUser.restContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                            assert.ok(!err);
                                                                                            _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                                                            // Verify cross-tenant anonymous cannot see it
                                                                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant1.anonymousRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                                assert.ok(!err);
                                                                                                _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);

                                                                                                // Verify cross-tenant admin cannot see it
                                                                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant1.adminRestContext, publicTenant.publicUser.user.id, null, null, function(err, items) {
                                                                                                    assert.ok(!err);
                                                                                                    _assertDoesNotContainItem(items.results, publicTenant.publicMeeting.id);
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
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });


        /**
         * Verify the access privacy of meetings inside a meeting user library. Ensures meetings in libraries do not leak to users viewing
         * other user libraries.
         */
        it('verify meeting group library privacy', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                var randomId = TestsUtil.generateTestGroupId();
                RestAPI.Group.createGroup(publicTenant.loggedinUser.restContext, randomId, randomId, 'public', 'no', [], [publicTenant.publicUser.user.id], function(err, group) {
                    assert.ok(!err);

                    // Share private, loggedin and public meeting with the group
                    RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.publicMeeting.id, [group.id], function(err) {
                        assert.ok(!err);

                        RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.loggedinMeeting.id, [group.id], function(err) {
                            assert.ok(!err);

                            RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.privateMeeting.id, [group.id], function(err) {
                                assert.ok(!err);

                                // Verify anonymous gets public library
                                RestAPI.Meetings.getMeetingsLibrary(publicTenant.anonymousRestContext, group.id, null, null, function(err, items) {
                                    assert.ok(!err);
                                    assert.equal(items.results.length, 1);
                                    _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                    // Verify authenticated same-tenant user gets loggedin library
                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.privateUser.restContext, group.id, null, null, function(err, items) {
                                        assert.ok(!err);
                                        assert.equal(items.results.length, 2);
                                        _assertContainsItem(items.results, publicTenant.publicMeeting.id);
                                        _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);

                                        // Verify member gets private library
                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, group.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.equal(items.results.length, 3);
                                            _assertContainsItem(items.results, publicTenant.publicMeeting.id);
                                            _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);
                                            _assertContainsItem(items.results, publicTenant.privateMeeting.id);

                                            // Verify authenticated cross-tenant user gets public library
                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant.anonymousRestContext, group.id, null, null, function(err, items) {
                                                assert.ok(!err);
                                                assert.equal(items.results.length, 1);
                                                _assertContainsItem(items.results, publicTenant.publicMeeting.id);

                                                // Verify admin gets private library
                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant.adminRestContext, group.id, null, null, function(err, items) {
                                                    assert.ok(!err);
                                                    assert.equal(items.results.length, 3);
                                                    _assertContainsItem(items.results, publicTenant.publicMeeting.id);
                                                    _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);
                                                    _assertContainsItem(items.results, publicTenant.privateMeeting.id);

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

        /**
         * Test that verifies validation logic for sharing meetings
         */
        it('verify meeting share validation', function(callback) {
            // Create users to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, user) {
                assert.ok(!err);
                var user1 = _.values(user)[0];
                var user2 = _.values(user)[1];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // Create meeting to test with
                RestAPI.Meetings.createMeeting(user1.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Verify cannot share with invalid meeting id
                    RestAPI.Meetings.shareMeeting(user1.restContext, 'not-a-valid-id', [user2.user.id], function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Verify cannoy share with no target users
                        RestAPI.Meetings.shareMeeting(user1.restContext, meeting.id, [], function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 400);

                            RestAPI.Meetings.shareMeeting(user1.restContext, meeting.id, null, function(err) {
                                assert.ok(err);
                                assert.equal(err.code, 400);

                                // Verify cannot share with invalid target
                                RestAPI.Meetings.shareMeeting(user1.restContext, meeting.id, ['not-a-valid-id'], function(err) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);

                                    // Sanity check
                                    RestAPI.Meetings.shareMeeting(user1.restContext, meeting.id, [user2.user.id], function(err) {
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

        /**
         * Verify a share cannot demote a manager
         */
        it('verify sharing a meeting cannot result in a demotion of a manager', function(callback) {
            // Create users to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 3, function(err, user) {
                assert.ok(!err);
                var user1 = _.values(user)[0];
                var user2 = _.values(user)[1];
                var user3 = _.values(user)[1];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // Create meeting to test with
                RestAPI.Meetings.createMeeting(user1.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // user2 will share with user1 who is a manager
                    RestAPI.Meetings.shareMeeting(user2.restContext, meeting.id, [user1.user.id, user3.user.id], function(err) {
                        assert.ok(!err);

                        // Ensure user1 can still update the meeting
                        RestAPI.Meetings.updateMeeting(user1.restContext, meeting.id, {'visibility': 'private'}, function(err, meeting) {
                            assert.ok(!err);

                            // Get the meeting members and make sure it says the user1 role is manager
                            RestAPI.Meetings.getMeetingMembers(user1.restContext, meeting.id, null, null, function(err, members) {
                                assert.ok(!err);

                                var hasUser1 = false;
                                _.each(members.results, function(result) {
                                    if (result.profile.id === user1.user.id) {
                                        hasUser1 = true;
                                        assert.equal(result.role, 'manager');
                                    }
                                });

                                assert.ok(hasUser1);

                                return callback();
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies share permissions
         */
        it('verify meeting share permissions', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                // 1. Verify anonymous user cannot share public meeting
                RestAPI.Meetings.shareMeeting(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, [publicTenant.publicUser.user.id], function(err) {
                    assert.ok(err);
                    assert.equal(err.code, 401);

                    // 2. Verify authenticated user cannot share private meeting
                    RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.privateMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 401);

                        // 3. Verify authenticated user can share loggedin meeting
                        RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                            assert.ok(!err);

                            // 3.1 Verify it went into loggedinUser's library
                            RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                assert.ok(!err);
                                assert.equal(items.results.length, 1);
                                _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);

                                // 3.2 Verify loggedin user from another tenant cannot see the library from a loggedin user from another tenant
                                RestAPI.Meetings.getMeetingsLibrary(publicTenant1.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                    assert.equal(err.code, 401);

                                    // 4. Verify authenticated user can share loggedin meeting with public external tenant user
                                    RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [publicTenant1.publicUser.user.id], function(err) {
                                        assert.ok(!err);

                                        // 4.1 Verify it went into tenant1 publicUser's library
                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant1.publicUser.restContext, publicTenant1.publicUser.user.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.equal(items.results.length, 1);
                                            _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);

                                            // 4.2 Verify a user from the external tenant (publicTenant1) cannot see the loggedin item in the shared user's library, because it is loggedin from another tenant
                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant1.loggedinUser.restContext, publicTenant1.publicUser.user.id, null, null, function(err, items) {
                                                assert.ok(!err);
                                                assert.equal(items.results.length, 0);

                                                // 5. Verify authenticated user cannot share loggedin meeting with private external tenant user
                                                RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [privateTenant.publicUser.user.id], function(err) {
                                                    assert.ok(err);
                                                    assert.equal(err.code, 400);

                                                    // 6. Verify authenticated user cannot share external loggedin meeting
                                                    RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant1.loggedinMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                                                        assert.ok(err);
                                                        assert.equal(err.code, 401);

                                                        // 7. Verify authenticated user can share external public meeting
                                                        RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant1.publicMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                                                            assert.ok(!err);

                                                            // 7.1 Verify it went into the user's library
                                                            RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                                                assert.ok(!err);
                                                                assert.equal(items.results.length, 2);
                                                                _assertContainsItem(items.results, publicTenant1.publicMeeting.id);

                                                                // 7.2 Verify public user from the same tenant can see the public external item in the library -- because it is public.
                                                                RestAPI.Meetings.getMeetingsLibrary(publicTenant.publicUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                                                    assert.ok(!err);
                                                                    assert.equal(items.results.length, 2);
                                                                    _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);
                                                                    _assertContainsItem(items.results, publicTenant1.publicMeeting.id);

                                                                    // 8. Verify authenticated user cannot share external public meeting with external public user from private tenant
                                                                    RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, privateTenant1.publicMeeting.id, [privateTenant1.publicUser.user.id], function(err) {
                                                                        assert.ok(err);
                                                                        assert.equal(err.code, 400);

                                                                        // 9. Verify authenticated user cannot share external public meeting from private tenant with user from their own tenant
                                                                        RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, privateTenant1.publicMeeting.id, [publicTenant.publicUser.user.id], function(err) {
                                                                            assert.ok(err);
                                                                            assert.equal(err.code, 400);
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
            });
        });

        /**
         * Verify input validation logic for the update members method
         */
        it('verify meeting update members validation', function(callback) {
            // Create users to test with
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, user) {
                assert.ok(!err);
                var user1 = _.values(user)[0];
                var user2 = _.values(user)[1];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                var user2Update = {};
                user2Update[user2.user.id] = 'member';

                // Create meeting to test with
                RestAPI.Meetings.createMeeting(user1.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Verify invalid meeting id
                    RestAPI.Meetings.updateMeetingMembers(user1.restContext, 'not-a-valid-id', user2Update, function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Verify null update
                        RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, null, function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 400);

                            // Verify no updates
                            RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, {}, function(err) {
                                assert.ok(err);
                                assert.equal(err.code, 400);

                                // Verify invalid member id
                                RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, {'not-a-valid-id': 'member'}, function(err) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);

                                    // Verify invalid role
                                    user2Update[user2.user.id] = 'not-a-valid-role';
                                    RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, user2Update, function(err) {
                                        assert.ok(err);
                                        assert.equal(err.code, 400);

                                        // Verify the user is not a member
                                        user2Update[user2.user.id] = 'member';
                                        RestAPI.Meetings.getMeetingMembers(user1.restContext, meeting.id, null, null, function(err, members) {
                                            assert.ok(!err);
                                            assert.equal(members.results.length, 1);

                                            // Sanity check the inputs for success
                                            RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, user2Update, function(err) {
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

        /**
         * Test that verifies permission rules for updating meeting permissions
         */
        it('verify meeting update members and permissions', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                var setLoggedinUserMember = {};
                setLoggedinUserMember[publicTenant.loggedinUser.user.id] = 'member';

                var setPublicUserMember = {};
                setPublicUserMember[publicTenant.publicUser.user.id] = 'member';

                var setPublicUserManager = {};
                setPublicUserManager[publicTenant.publicUser.user.id] = 'manager';

                // 1. Verify anonymous user cannot update members
                RestAPI.Meetings.updateMeetingMembers(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, setLoggedinUserMember, function(err) {
                    assert.ok(err);
                    assert.equal(err.code, 401);

                    // 2. Verify loggedin non-member user cannot update members
                    RestAPI.Meetings.updateMeetingMembers(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, setLoggedinUserMember, function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 401);

                        // 3. Verify member user cannot update members
                        RestAPI.Meetings.updateMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, setPublicUserMember, function(err) {
                            assert.ok(!err);

                            RestAPI.Meetings.updateMeetingMembers(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, setLoggedinUserMember, function(err) {
                                assert.ok(err);
                                assert.equal(err.code, 401);

                                // 4. Verify cannot set access across to private tenant
                                var setExternalPrivateUserMember = {};
                                setExternalPrivateUserMember[privateTenant.publicUser.id] = 'member';
                                RestAPI.Meetings.updateMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, setExternalPrivateUserMember, function(err) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);

                                    // 5. Ensure the access hasn't changed
                                    RestAPI.Meetings.getMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, null, null, function(err, items) {
                                        assert.ok(!err);
                                        assert.equal(items.results.length, 2);

                                        var hadPublicUser = false;
                                        _.each(items.results, function(result) {
                                            if (result.profile.id === publicTenant.publicUser.user.id) {
                                                // Ensure the public user is a member
                                                hadPublicUser = true;
                                                assert.equal(result.role, 'member');
                                            }
                                        });

                                        assert.ok(hadPublicUser);

                                        // 6. Verify manager user can update members
                                        RestAPI.Meetings.updateMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, setPublicUserManager, function(err) {
                                            assert.ok(!err);

                                            RestAPI.Meetings.updateMeetingMembers(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, setLoggedinUserMember, function(err) {
                                                assert.ok(!err);

                                                // 7. Ensure the access has now changed
                                                RestAPI.Meetings.getMeetingMembers(publicTenant.adminRestContext, publicTenant.publicMeeting.id, null, null, function(err, items) {
                                                    assert.ok(!err);
                                                    // Tenant admin and public user are the only ones
                                                    assert.equal(items.results.length, 3);

                                                    var hadPublicUser = false;
                                                    var hadLoggedinUser = false;
                                                    _.each(items.results, function(result) {
                                                        if (result.profile.id === publicTenant.publicUser.user.id) {
                                                            // Ensure the public user is now a manager
                                                            hadPublicUser = true;
                                                            assert.equal(result.role, 'manager');
                                                        } else if (result.profile.id === publicTenant.loggedinUser.user.id) {
                                                            // Ensure the loggedin user is just a member
                                                            hadLoggedinUser = true;
                                                            assert.equal(result.role, 'member');
                                                        }
                                                    });

                                                    assert.ok(hadPublicUser);
                                                    assert.ok(hadLoggedinUser);
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

        /**
         * Test that verifies logic of removing meetings from libraries, and the awkward permissions cases for the operation
         */
        it('verify meeting remove from library and permissions', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                // 1. Verify member can remove private meeting from their library
                RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                    assert.ok(!err);

                    // 1.1 Remove it
                    RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, publicTenant.loggedinMeeting.id, function(err) {
                        assert.ok(!err);

                        // 1.2 Make sure it isn't there
                        RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                            assert.ok(!err);
                            assert.equal(items.results.length, 0);

                            // 2. Verify user can remove item from their library across tenant boundaries

                            // 2.1 Share an item from an external public tenant
                            RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant1.publicMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                                assert.ok(!err);

                                // 2.1 Make that tenant private
                                ConfigTestsUtil.updateConfigAndWait(TestsUtil.createGlobalAdminRestContext(), publicTenant1.tenant.alias, {'oae-tenants/tenantprivacy/tenantprivate': true}, function(err) {
                                    assert.ok(!err);

                                    // 2.2 Removes it from the library, should be able to even though the meeting's tenant has become private
                                    RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, publicTenant1.publicMeeting.id, function(err) {
                                        assert.ok(!err);

                                        // 2.3 Make sure it isn't there
                                        RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.equal(items.results.length, 0);

                                            // 3. Verify user cannot remove a meeting from another user's library
                                            RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [publicTenant.loggedinUser.user.id], function(err) {
                                                assert.ok(!err);

                                                // 3.1 Try and remove it with another user
                                                RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.publicUser.restContext, publicTenant.loggedinUser.user.id, publicTenant.loggedinMeeting.id, function(err) {
                                                    assert.ok(err);
                                                    assert.equal(err.code, 401);

                                                    // 3.2 Make sure it is still there
                                                    RestAPI.Meetings.getMeetingsLibrary(publicTenant.loggedinUser.restContext, publicTenant.loggedinUser.user.id, null, null, function(err, items) {
                                                        assert.ok(!err);
                                                        assert.equal(items.results.length, 1);
                                                        _assertContainsItem(items.results, publicTenant.loggedinMeeting.id);

                                                        var randomId = TestsUtil.generateTestGroupId();
                                                        RestAPI.Group.createGroup(publicTenant.loggedinUser.restContext, randomId, randomId, 'public', 'no', [], [publicTenant.publicUser.user.id], function(err, group) {
                                                            assert.ok(!err);

                                                            // Share an item with the group
                                                            RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [group.id], function(err) {
                                                                assert.ok(!err);

                                                                // Try and remove it with a member user, should fail because only managers can remove from library
                                                                RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.publicUser.restContext, group.id, publicTenant.loggedinMeeting.id, function(err) {
                                                                    assert.ok(err);
                                                                    assert.equal(err.code, 401);

                                                                    // Try and remove it with a manager user. Should succeed
                                                                    RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.loggedinUser.restContext, group.id, publicTenant.loggedinMeeting.id, function(err) {
                                                                        assert.ok(!err);

                                                                        // Share an item with the group again
                                                                        RestAPI.Meetings.shareMeeting(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, [group.id], function(err) {
                                                                            assert.ok(!err);

                                                                            // Try and remove it with a tenant admin. Should succeed again
                                                                            RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.adminRestContext, group.id, publicTenant.loggedinMeeting.id, function(err) {
                                                                                assert.ok(!err);

                                                                                // Verify it complains when a user tries to remove a meeting from their library that isn't in it
                                                                                RestAPI.Meetings.removeMeetingFromLibrary(publicTenant.adminRestContext, group.id, publicTenant.loggedinMeeting.id, function(err) {
                                                                                    assert.ok(err);
                                                                                    assert.ok(err.code, 400);
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
                    });
                });
            });
        });

        /**
         * Test that verifies a meeting cannot be reduced to 0 manager members
         */
        it('verify meeting does not end up with 0 managers', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, user) {
                assert.ok(!err);
                var user1 = _.values(user)[0];
                var user2 = _.values(user)[1];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // user1 becomes manager of meeting
                RestAPI.Meetings.createMeeting(user1.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Try and make user1 remove it from their library, they shouldn't as they are only manager
                    RestAPI.Meetings.removeMeetingFromLibrary(user1.restContext, user1.user.id, meeting.id, function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Try and demote user1 to member when they are the only manager
                        var makeUserMember = {};
                        makeUserMember[user1.user.id] = 'member';
                        RestAPI.Meetings.updateMeetingMembers(camAdminRestCtx, meeting.id, makeUserMember, function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 400);

                            // Make user2 manager so we can test demoting user1 now
                            var makeUser2Manager = {};
                            makeUser2Manager[user2.user.id] = 'manager';
                            RestAPI.Meetings.updateMeetingMembers(user1.restContext, meeting.id, makeUser2Manager, function(err) {
                                assert.ok(!err);

                                // Admin should now be able to demote user1 since there is another manager
                                RestAPI.Meetings.updateMeetingMembers(camAdminRestCtx, meeting.id, makeUserMember, function(err) {
                                    assert.ok(!err);
                                    return callback();
                                });
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies validation of inputs for removing a meeting from a library
         */
        it('verify remove from library validation', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                RestAPI.Meetings.removeMeetingFromLibrary(user.restContext, user.user.id, 'not-a-valid-id', function(err) {
                    assert.ok(err);
                    assert.equal(err.code, 400, JSON.stringify(err, null, 4));

                    RestAPI.Meetings.removeMeetingFromLibrary(user.restContext, 'not-a-valid-id', 'd:cam:somenonexistent', function(err) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        RestAPI.Meetings.removeMeetingFromLibrary(user.restContext, user.user.id, 'd:cam:somenonexistent', function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 404);
                            return callback();
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies library feeds are automatically repaired when there are duplicate items in the feed
         */
        it('verify library auto-repair on duplicate items', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test';
                var description = 'test';
                var visibility = 'public';

                // Create 2 library items to test with
                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting1) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting2) {
                        assert.ok(!err);

                        // List the feed to seed the library with the given data
                        RestAPI.Meetings.getMeetingsLibrary(user.restContext, user.user.id, null, null, function(err, items) {
                            assert.ok(!err);
                            assert.equal(items.results.length, 2);

                            // Revert the meeting2 lastModified to over an hour ago so we can induce a duplicate
                            var oldLastModified = meeting2.lastModified - (1 * 60 * 61 * 1000);
                            MeetingsDAO.updateMeeting(meeting2, {'lastModified': oldLastModified}, function(err, meeting2) {
                                assert.ok(!err);

                                // Post a message to force it to update the lastModified. This will cause a duplicate because we tampered with the lastModified
                                RestAPI.Meetings.createMessage(user.restContext, meeting2.id, 'My message', null, function(err, message) {
                                    assert.ok(!err);
                                    LibraryAPI.Index.whenUpdatesComplete(function() {

                                        // At this point we will have 3 items in our library index. 2 for meeting2 and one for discssion1. Now we page to observe
                                        // the auto-repair. Since the library update happens asynchronously to the message, we need to try several times to jam it
                                        // through.

                                        /*!
                                         * Continue checking the library feed until the tries run out. When the feed reaches a state where it is inconsistent
                                         * (i.e., a fetch of 2 items only returns 1, and there are more to fetch), then we proceed to fetch the feed until it
                                         * has become consistent again (i.e., the fetch of 2 items once again returns exactly 2 items)
                                         *
                                         * If this fails, it means the feed has not become inconsistent. What gives?
                                         *
                                         * @param  {Number}     triesLeft   The number of tries to perform
                                         */
                                        var _checkDuplicatedFeed = function(triesLeft) {
                                            if (triesLeft === 0) {
                                                // Fail if we have run out of tries
                                                assert.fail('The library did not incur a duplicate within a certain amount of tries');
                                            }

                                            // The first time, we set a limit 2, we should end up with only 1. Because the one duplicate was filtered out
                                            RestAPI.Meetings.getMeetingsLibrary(user.restContext, user.user.id, null, 2, function(err, items) {
                                                assert.ok(!err);

                                                try {
                                                    assert.equal(items.results.length, 1);
                                                    _assertContainsItem(items.results, meeting2.id);

                                                    // nextToken should be there because there was still 1 item to page through (meeting1)
                                                    assert.ok(items.nextToken);

                                                    // We fetch an inconsistent feed, this is good. This fetch, since it was inconsistent should have
                                                    // triggered a repair. Now check the feed until it has been repaired
                                                    return _checkRepairedFeed(10);
                                                } catch (assertionErr) {
                                                    return setTimeout(_checkDuplicatedFeed, 50, triesLeft - 1);
                                                }
                                            });
                                        };

                                        /*!
                                         * Continue checking the library feed until it comes consistent.
                                         *
                                         * If this fails, it means the feed never returned to be consistent. What gives?
                                         *
                                         * @param  {Number}     triesLeft   The number of tries to perform
                                         */
                                        var _checkRepairedFeed = function(triesLeft) {
                                            if (triesLeft === 0) {
                                                assert.fail('The library feed was not auto-repaired within a certain amount of tries.');
                                            }

                                            triesLeft--;

                                            RestAPI.Meetings.getMeetingsLibrary(user.restContext, user.user.id, null, 2, function(err, items) {
                                                assert.ok(!err);

                                                try {
                                                    assert.equal(items.results.length, 2);
                                                    _assertContainsItem(items.results, meeting2.id);
                                                    _assertContainsItem(items.results, meeting1.id);

                                                    // Everything checked out, continue on with the tests!
                                                    return callback();
                                                } catch (assertionError) {
                                                    // Not in the right state yet. Try again
                                                    return _checkRepairedFeed(triesLeft);
                                                }
                                            });
                                        };

                                        // Start the check for an inconsistent feed
                                        _checkDuplicatedFeed(100);
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

    });


    describe('Messages', function() {

        /**
         * Test that verifies input validation when creating a message
         */
        it('verify message creation validation', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, user) {
                assert.ok(!err);
                var user1 = _.values(user)[0];
                var user2 = _.values(user)[1];

                var displayName = 'test-create-displayName';
                var description = 'test-create-description';
                var visibility = 'public';

                // Create meeting to test with
                RestAPI.Meetings.createMeeting(user1.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Test invalid meeting id
                    RestAPI.Meetings.createMessage(user1.restContext, 'not-a-valid-id', 'This should result in a 400', null, function(err, message) {
                        assert.ok(err);
                        assert.equal(err.code, 400);
                        assert.ok(!message);

                        // Test no body
                        RestAPI.Meetings.createMessage(user1.restContext, meeting.id, null, null, function(err, message) {
                            assert.ok(err);
                            assert.equal(err.code, 400);
                            assert.ok(!message);

                            // Test invalid reply-to timestamp
                            RestAPI.Meetings.createMessage(user1.restContext, meeting.id, 'This should result in a 400', 'NaN', function(err, message) {
                                assert.ok(err);
                                assert.equal(err.code, 400);
                                assert.ok(!message);

                                // Test non-existing reply-to timestamp
                                RestAPI.Meetings.createMessage(user1.restContext, meeting.id, 'This should result in a 400', Date.now(), function(err, message) {
                                    assert.ok(err);
                                    assert.equal(err.code, 400);
                                    assert.ok(!message);

                                    // Test a body that is longer than the maximum allowed size
                                    var body = TestsUtil.generateRandomText(10000);
                                    RestAPI.Meetings.createMessage(user1.restContext, meeting.id, body, null, function(err, message) {
                                        assert.ok(err);
                                        assert.equal(err.code, 400);
                                        assert.ok(!message);

                                        // Sanity check
                                        RestAPI.Meetings.createMessage(user1.restContext, meeting.id, 'This should be ok', null, function(err, message) {
                                            assert.ok(!err);
                                            assert.ok(message);
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
         * Test that verifies the model of created messages, and permissions of creating messages on different types of meetings
         */
        it('verify creating a message, model and permissions', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
                // Cannot post message as anonymous user
                RestAPI.Meetings.createMessage(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, 'This should result in a 401', null, function(err, message) {
                    assert.ok(err);
                    assert.equal(err.code, 401);
                    assert.ok(!message);

                    // Cannot post to private meeting as non-member
                    RestAPI.Meetings.createMessage(publicTenant.privateUser.restContext, publicTenant.privateMeeting.id, 'This should result in a 401', null, function(err, message) {
                        assert.ok(err);
                        assert.equal(err.code, 401);
                        assert.ok(!message);

                        // Can post as an authenticated user from the same tenant, verify the model
                        RestAPI.Meetings.createMessage(publicTenant.publicUser.restContext, publicTenant.publicMeeting.id, 'Top-level message', null, function(err, message) {
                            assert.ok(!err);
                            assert.ok(message);

                            // This is the expected messagebox id of the meeting
                            var messageBoxId = publicTenant.publicMeeting.id;

                            assert.equal(message.id, messageBoxId + '#' + message.created);
                            assert.equal(message.messageBoxId, messageBoxId);
                            assert.equal(message.threadKey, message.created + '|');
                            assert.equal(message.body, 'Top-level message');
                            assert.equal(message.createdBy.id, publicTenant.publicUser.user.id);
                            assert.notEqual(parseInt(message.created, 10), NaN);
                            assert.strictEqual(message.level, 0);
                            assert.ok(!message.replyTo);

                            // Reply to that message and verify the model
                            RestAPI.Meetings.createMessage(publicTenant.loggedinUser.restContext, publicTenant.publicMeeting.id, 'Reply message', message.created, function(err, replyMessage) {
                                assert.ok(!err);
                                assert.ok(replyMessage);

                                // This is the expected replyMessagebox id of the meeting
                                assert.equal(replyMessage.id, messageBoxId + '#' + replyMessage.created);
                                assert.equal(replyMessage.messageBoxId, messageBoxId);
                                assert.equal(replyMessage.threadKey, message.created + '#' + replyMessage.created + '|');
                                assert.equal(replyMessage.body, 'Reply message');
                                assert.equal(replyMessage.createdBy.id, publicTenant.loggedinUser.user.id);
                                assert.notEqual(parseInt(replyMessage.created, 10), NaN);
                                assert.strictEqual(replyMessage.level, 1);
                                assert.ok(replyMessage.replyTo, message.created);

                                // Cross-tenant user from public tenant can post to a public meeting
                                RestAPI.Meetings.createMessage(publicTenant1.publicUser.restContext, publicTenant.publicMeeting.id, 'Message from external user', null, function(err, message) {
                                    assert.ok(!err);
                                    assert.ok(message);

                                    // Cross-tenant user from public tenant cannot post to a loggedin meeting
                                    RestAPI.Meetings.createMessage(publicTenant1.publicUser.restContext, publicTenant.loggedinMeeting.id, 'Message from external user', null, function(err, message) {
                                        assert.ok(err);
                                        assert.ok(err.code, 401);
                                        assert.ok(!message);

                                        // Cross-tenant user from private tenant cannot post to a public meeting
                                        RestAPI.Meetings.createMessage(privateTenant.publicUser.restContext, publicTenant.publicMeeting.id, 'Message from external user', null, function(err, message) {
                                            assert.ok(err);
                                            assert.ok(err.code, 401);
                                            assert.ok(!message);

                                            // Cross-tenant admin cannot post to a loggedin meeting
                                            RestAPI.Meetings.createMessage(publicTenant1.adminRestContext, publicTenant.loggedinMeeting.id, 'Message from external user', null, function(err, message) {
                                                assert.ok(err);
                                                assert.ok(err.code, 401);
                                                assert.ok(!message);

                                                // Can post to private meeting as a member. Share it, then test creating a message
                                                RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.privateMeeting.id, [publicTenant.privateUser.user.id], function(err) {
                                                    assert.ok(!err);

                                                    RestAPI.Meetings.createMessage(publicTenant.privateUser.restContext, publicTenant.privateMeeting.id, 'Message from member', null, function(err, message) {
                                                        assert.ok(!err);
                                                        assert.ok(message);

                                                        // Can post to meeting as admin
                                                        RestAPI.Meetings.createMessage(publicTenant.adminRestContext, publicTenant.privateMeeting.id, 'Message from admin', null, function(err, message) {
                                                            assert.ok(!err);
                                                            assert.ok(message);
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

        /**
         * Test that verifies that messages contain user profile pictures
         */
        it('verify messages contain user profile pictures', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users, bert, nicolaas) {
                assert.ok(!err);

                /**
                 * Return a profile picture stream
                 *
                 * @return {Stream}     A stream containing an profile picture
                 */
                var getPictureStream = function() {
                    var file = __dirname + '/data/profilepic.jpg';
                    return fs.createReadStream(file);
                };

                // Give one of the users a profile picture
                var cropArea = {'x': 0, 'y': 0, 'width': 250, 'height': 250};
                RestAPI.User.uploadPicture(bert.restContext, bert.user.id, getPictureStream, cropArea, function(err) {
                    assert.ok(!err);

                    // Create a meeting and share it with a user that has no profile picture
                    RestAPI.Meetings.createMeeting(bert.restContext, 'displayName', 'description', 'public', null, [nicolaas.user.id], function(err, meeting) {
                        assert.ok(!err);

                        // Add a message to the meeting as a user with a profile picture
                        RestAPI.Meetings.createMessage(bert.restContext, meeting.id, 'Message body 1', null, function(err, message) {
                            assert.ok(!err);

                            // Assert that the picture URLs are present
                            assert.ok(message.createdBy);
                            assert.ok(message.createdBy.picture);
                            assert.ok(message.createdBy.picture.small);
                            assert.ok(message.createdBy.picture.medium);
                            assert.ok(message.createdBy.picture.large);

                            // Assert that this works for replies as well
                            RestAPI.Meetings.createMessage(bert.restContext, meeting.id, 'Message body 2', message.created, function(err, reply) {
                                assert.ok(!err);

                                 // Assert that no picture URLs are present
                                assert.ok(reply.createdBy);
                                assert.ok(reply.createdBy.picture);
                                assert.ok(reply.createdBy.picture.small);
                                assert.ok(reply.createdBy.picture.medium);
                                assert.ok(reply.createdBy.picture.large);

                                // Add a message to the meeting as a user with no profile picture
                                RestAPI.Meetings.createMessage(nicolaas.restContext, meeting.id, 'Message body 3', null, function(err, message) {
                                    assert.ok(!err);

                                    // Assert that no picture URLs are present
                                    assert.ok(message.createdBy);
                                    assert.ok(message.createdBy.picture);
                                    assert.ok(!message.createdBy.picture.small);
                                    assert.ok(!message.createdBy.picture.medium);
                                    assert.ok(!message.createdBy.picture.large);

                                    // Assert that this works for replies as well
                                    RestAPI.Meetings.createMessage(nicolaas.restContext, meeting.id, 'Message body 4', message.created, function(err, reply) {
                                        assert.ok(!err);

                                        // Assert that no picture URLs are present
                                        assert.ok(reply.createdBy);
                                        assert.ok(reply.createdBy.picture);
                                        assert.ok(!reply.createdBy.picture.small);
                                        assert.ok(!reply.createdBy.picture.medium);
                                        assert.ok(!reply.createdBy.picture.large);


                                        // Assert the profile picture urls are present when retrieving a list of messages
                                        RestAPI.Meetings.getMessages(bert.restContext, meeting.id, null, 10, function(err, messages) {
                                            assert.ok(!err);
                                            assert.equal(messages.results.length, 4);
                                            _.each(messages.results, function(message) {
                                                assert.ok(message.createdBy);
                                                assert.ok(message.createdBy.picture);
                                                // Verify that the messages have a picture for the user that
                                                // has a profile picture
                                                if (message.createdBy.id === bert.user.id) {
                                                    assert.ok(message.createdBy.picture.small);
                                                    assert.ok(message.createdBy.picture.medium);
                                                    assert.ok(message.createdBy.picture.large);
                                                // Verify that the messages don't have a picture for the user
                                                // without a profile picture
                                                } else if (message.createdBy.id === nicolaas.user.id) {
                                                    assert.ok(!message.createdBy.picture.small);
                                                    assert.ok(!message.createdBy.picture.medium);
                                                    assert.ok(!message.createdBy.picture.large);
                                                } else {
                                                    assert.fail('Unexpected user in messages');
                                                }
                                            });
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
         * Test that verifies a meeting is updated at most every hour as a result of new message postings
         */
        it('verify meeting update threshold with messages', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test';
                var description = 'test';
                var visibility = 'public';

                // Create a meeting to test with
                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    var lastModified1 = meeting.lastModified;

                    // Create a meeting to test with
                    RestAPI.Meetings.createMessage(user.restContext, meeting.id, 'My message', null, function(err, message) {
                        assert.ok(!err);

                        // Ensure lastModified didn't change because it is within the one hour threshold (hopefully)
                        RestAPI.Meetings.getMeeting(user.restContext, meeting.id, function(err, meeting) {
                            assert.ok(!err);
                            assert.equal(meeting.lastModified, lastModified1);

                            // Force a naughty update through the DAO of the lastModified to more than an hour ago (threshold duration)
                            var lastModified0 = lastModified1 - (1 * 60 * 61 * 1000);
                            MeetingsDAO.updateMeeting(meeting, {'lastModified': lastModified0}, function(err, meeting) {
                                assert.ok(!err);
                                assert.equal(meeting.lastModified, lastModified0);

                                // Message again, this time the lastModified should update
                                RestAPI.Meetings.createMessage(user.restContext, meeting.id, 'My message', null, function(err, message) {
                                    assert.ok(!err);

                                    // Ensure the new lastModified is greater than the original creation one
                                    RestAPI.Meetings.getMeeting(user.restContext, meeting.id, function(err, meeting) {
                                        assert.ok(!err);
                                        assert.ok(parseInt(meeting.lastModified, 10) > parseInt(lastModified1, 10));

                                        // Note at this time, since the lastModified of the meeting updated under the hood without
                                        // a library update, the library of user should 2 versions of this meeting. Lets see if it
                                        // auto-repairs

                                        // Make sure the library does not have a duplicate
                                        RestAPI.Meetings.getMeetingsLibrary(user.restContext, user.user.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.equal(items.results.length, 1);
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
         * Test that verifies input validation of listing messages from a meeting
         */
        it('verify list messages validation', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test';
                var description = 'test';
                var visibility = 'public';

                // Create a meeting to test with
                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Validate invalid meeting id
                    RestAPI.Meetings.getMessages(user.restContext, 'not-a-valid-id', null, null, function(err, messages) {
                        assert.ok(err);
                        assert.equal(err.code, 400);

                        // Validate invalid limit
                        // It should default to 10 messages
                        RestAPI.Meetings.getMessages(user.restContext, meeting.id, null, 'not-a-valid-limit', function(err, messages) {
                            assert.ok(!err);
                            assert.ok(messages);

                            // Sanity check
                            RestAPI.Meetings.getMessages(user.restContext, meeting.id, null, null, function(err, messages) {
                                assert.ok(!err);
                                assert.ok(messages);
                                return callback();
                            });
                        });
                    });
                });
            });
        });

        /**
         * Test that verifies the model of messages, and permissions for accessing them
         */
        it('verify listing messages, model and permissions', function(callback) {

            /*!
             * Ensure that the message model is correct between the message to test and the message against which to test.
             *
             * @param  {Message}    messageToTest           The message to test
             * @param  {Message}    messageToTestAgainst    The message against which to test
             * @param  {User}       creatorToTestAgainst    The user data (i.e., `createdBy`) to test against for the message creator
             * @param  {Boolean}    userScrubbed            Whether or not the createdBy field should have scrubbed user data
             * @throws {Error}                              Throws an assertion error if the data fails assertions
             */
            var _assertMessageModel = function(messageToTest, messageToTestAgainst, creatorToTestAgainst, userScrubbed) {

                // Verify message model
                assert.equal(messageToTest.id, messageToTestAgainst.id);
                assert.equal(messageToTest.messageBoxId, messageToTestAgainst.messageBoxId);
                assert.equal(messageToTest.threadKey, messageToTestAgainst.threadKey);
                assert.equal(messageToTest.body, messageToTestAgainst.body);
                assert.equal(messageToTest.created, messageToTestAgainst.created);
                assert.strictEqual(messageToTest.level, messageToTestAgainst.level);
                assert.equal(messageToTest.replyTo, messageToTestAgainst.replyTo);

                // Verify creator model
                assert.ok(messageToTest.createdBy);
                assert.equal(messageToTest.createdBy.tenant.alias, creatorToTestAgainst.tenant.alias);
                assert.equal(messageToTest.createdBy.tenant.displayName, creatorToTestAgainst.tenant.displayName);
                assert.equal(messageToTest.createdBy.visibility, creatorToTestAgainst.visibility);

                // Privacy check
                if (userScrubbed) {
                    assert.equal(messageToTest.createdBy.displayName, creatorToTestAgainst.publicAlias);
                } else {
                    assert.equal(messageToTest.createdBy.displayName, creatorToTestAgainst.displayName);
                }
            };

            // Set up the tenants for tenant privacy rule checking
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {


                // Create message structure on the public meeting
                RestAPI.Meetings.createMessage(publicTenant.loggedinUser.restContext, publicTenant.publicMeeting.id, 'Message1 parent on public', null, function(err, publicMessage1) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMessage(publicTenant.loggedinUser.restContext, publicTenant.publicMeeting.id, 'Message1 reply on public', publicMessage1.created, function(err, replyPublicMessage1) {
                        assert.ok(!err);

                        RestAPI.Meetings.createMessage(publicTenant.loggedinUser.restContext, publicTenant.publicMeeting.id, 'Message2 parent on public', null, function(err, publicMessage2) {
                            assert.ok(!err);


                            // Create message on the loggedin meeting
                            RestAPI.Meetings.createMessage(publicTenant.loggedinUser.restContext, publicTenant.loggedinMeeting.id, 'Message on loggedin', null, function(err, loggedinMessage) {
                                assert.ok(!err);


                                // Share and post message on the private meeting
                                RestAPI.Meetings.shareMeeting(publicTenant.adminRestContext, publicTenant.privateMeeting.id, [publicTenant.privateUser.user.id], function(err) {
                                    assert.ok(!err);

                                    RestAPI.Meetings.createMessage(publicTenant.privateUser.restContext, publicTenant.privateMeeting.id, 'Message on private', null, function(err, privateMessage) {
                                        assert.ok(!err);


                                        // Anonymous can read on public, but not loggedin or private
                                        RestAPI.Meetings.getMessages(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, null, null, function(err, messages) {
                                            assert.ok(!err);
                                            assert.ok(messages);
                                            assert.equal(messages.results.length, 3);

                                            // Verify the model of all 3 messages
                                            _assertMessageModel(messages.results[0], publicMessage2, publicTenant.loggedinUser.user, true);
                                            _assertMessageModel(messages.results[1], publicMessage1, publicTenant.loggedinUser.user, true);
                                            _assertMessageModel(messages.results[2], replyPublicMessage1, publicTenant.loggedinUser.user, true);

                                            RestAPI.Meetings.getMessages(publicTenant.anonymousRestContext, publicTenant.loggedinMeeting.id, null, null, function(err, messages) {
                                                assert.ok(err);
                                                assert.ok(err.code, 401);
                                                assert.ok(!messages);

                                                RestAPI.Meetings.getMessages(publicTenant.anonymousRestContext, publicTenant.privateMeeting.id, null, null, function(err, messages) {
                                                    assert.ok(err);
                                                    assert.ok(err.code, 401);
                                                    assert.ok(!messages);


                                                    // Authenticated user can read loggedin
                                                    RestAPI.Meetings.getMessages(publicTenant.publicUser.restContext, publicTenant.loggedinMeeting.id, null, null, function(err, messages) {
                                                        assert.ok(!err);
                                                        assert.ok(messages);
                                                        assert.equal(messages.results.length, 1);

                                                        // Verify the model of the message, the loggedin user should not be scrubbed
                                                        _assertMessageModel(messages.results[0], loggedinMessage, publicTenant.loggedinUser.user, false);

                                                        // Authenticated user cannot read private
                                                        RestAPI.Meetings.getMessages(publicTenant.publicUser.restContext, publicTenant.privateMeeting.id, null, null, function(err, messages) {
                                                            assert.ok(err);
                                                            assert.ok(err.code, 401);
                                                            assert.ok(!messages);

                                                            // Member user can read private
                                                            RestAPI.Meetings.getMessages(publicTenant.privateUser.restContext, publicTenant.privateMeeting.id, null, null, function(err, messages) {
                                                                assert.ok(!err);
                                                                assert.ok(messages);
                                                                assert.equal(messages.results.length, 1);

                                                                // Verify the model of the message, the loggedin user should not be scrubbed
                                                                _assertMessageModel(messages.results[0], privateMessage, publicTenant.privateUser.user, false);

                                                                // Ensure paging of the messages

                                                                // Get the first two only
                                                                RestAPI.Meetings.getMessages(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, null, 2, function(err, messages) {
                                                                    assert.ok(!err);
                                                                    assert.ok(messages);
                                                                    assert.equal(messages.nextToken, messages.results[1].threadKey);

                                                                    assert.equal(messages.results.length, 2);

                                                                    // Verify the model and ordering of the messages
                                                                    _assertMessageModel(messages.results[0], publicMessage2, publicTenant.loggedinUser.user, true);
                                                                    _assertMessageModel(messages.results[1], publicMessage1, publicTenant.loggedinUser.user, true);

                                                                    // Try and get 2 more. Should only get 1 and it should be the 3rd message
                                                                    RestAPI.Meetings.getMessages(publicTenant.anonymousRestContext, publicTenant.publicMeeting.id, publicMessage1.threadKey, 2, function(err, messages) {
                                                                        assert.ok(!err);
                                                                        assert.ok(messages);
                                                                        assert.equal(messages.results.length, 1);
                                                                        assert.ok(!messages.nextToken);

                                                                        // Verify the model and ordering of the messages
                                                                        _assertMessageModel(messages.results[0], replyPublicMessage1, publicTenant.loggedinUser.user, true);

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
        });

        /**
         * Test that verifies input validation of deleting messages from a meeting
         */
        it('verify delete message validation', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var displayName = 'test';
                var description = 'test';
                var visibility = 'public';

                // Create a meeting to test with
                RestAPI.Meetings.createMeeting(user.restContext, displayName, description, visibility, null, null, function(err, meeting) {
                    assert.ok(!err);

                    // Create message on the meeting to delete
                    RestAPI.Meetings.createMessage(user.restContext, meeting.id, 'a message', null, function(err, message) {
                        assert.ok(!err);

                        // Validate invalid meeting id
                        RestAPI.Meetings.deleteMessage(user.restContext, 'not-an-id', message.created, function(err) {
                            assert.ok(err);
                            assert.equal(err.code, 400);

                            // Validate invalid timestamp
                            RestAPI.Meetings.deleteMessage(user.restContext, meeting.id, 'invalid-created', function(err) {
                                assert.ok(err);
                                assert.equal(err.code, 400);

                                // Sanity check input
                                RestAPI.Meetings.deleteMessage(user.restContext, meeting.id, message.created, function(err) {
                                    assert.ok(!err);
                                    return callback();
                                });
                            });
                        });
                    });
                });
            });
        });

        /*!
         * Ensure that deleting messages works as expected with the given tenant, users and meeting
         *
         * @param  {Object}         tenant          The tenant info object for the tenant under which the test occurs
         * @param  {Object}         managerUser     The user info object (as per MeetingsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will act as the manager of the meeting
         * @param  {Object}         memberUser      The user info object (as per MeetingsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will act as the member of the meeting
         * @param  {Object}         nonMemberUser   The user info object (as per MeetingsTestsUtil#setupMultiTenantPrivacyEntities) for the user who will not be explicitly associated to the meeting, but will be authenticated to the tenant
         * @param  {Meeting}     meeting      The meeting against which to create and delete messages, verifying the expected outcomes
         * @param  {Function}       callback        Invoked when all assertions have passed
         * @throws {AssertionError}                 Thrown if any of the assertions failed while creating and deleting messages
         */
        var _assertDeleteMessagePermissions = function(tenant, managerUser, memberUser, nonMemberUser, meeting, callback) {
            // Add the manager and member users to the meeting
            var updates = {};
            updates[managerUser.user.id] = 'manager';
            updates[memberUser.user.id] = 'member';
            RestAPI.Meetings.updateMeetingMembers(tenant.adminRestContext, meeting.id, updates, function(err) {
                assert.ok(!err);

                // Create a message structure on the meeting
                RestAPI.Meetings.createMessage(memberUser.restContext, meeting.id, 'Message1 parent on public', null, function(err, message1) {
                    assert.ok(!err);

                    RestAPI.Meetings.createMessage(memberUser.restContext, meeting.id, 'Message1 reply on public', message1.created, function(err, replyMessage1) {
                        assert.ok(!err);

                        RestAPI.Meetings.createMessage(memberUser.restContext, meeting.id, 'Message2 parent on public', null, function(err, message2) {
                            assert.ok(!err);

                            // Verify that anonymous cannot delete a message
                            RestAPI.Meetings.deleteMessage(tenant.anonymousRestContext, meeting.id, message1.created, function(err, message) {
                                assert.ok(err);
                                assert.equal(err.code, 401);
                                assert.ok(!message);

                                // Verify that a non-manager and non-creator user can't delete a message
                                RestAPI.Meetings.deleteMessage(nonMemberUser.restContext, meeting.id, message1.created, function(err, message) {
                                    assert.ok(err);
                                    assert.equal(err.code, 401);
                                    assert.ok(!message);

                                    // Verify that a manager can delete the message, also verify that the parent message is soft-deleted and its resulting model
                                    RestAPI.Meetings.deleteMessage(managerUser.restContext, meeting.id, message1.created, function(err, message) {
                                        assert.ok(!err);
                                        assert.ok(message);

                                        // Ensure the deleted message model
                                        assert.equal(message.id, message1.id);
                                        assert.equal(message.messageBoxId, message1.messageBoxId);
                                        assert.equal(message.threadKey, message1.threadKey);
                                        assert.equal(message.created, message1.created);
                                        assert.equal(message.replyTo, message1.replyTo);
                                        assert.notEqual(parseInt(message.deleted, 10), NaN);
                                        assert.ok(parseInt(message.deleted, 10) > parseInt(message.created, 10));
                                        assert.strictEqual(message.level, message1.level);
                                        assert.ok(!message.body);
                                        assert.ok(!message.createdBy);

                                        // Ensure the deleted message is in the list of messages still, but deleted
                                        RestAPI.Meetings.getMessages(managerUser.restContext, meeting.id, null, null, function(err, items) {
                                            assert.ok(!err);
                                            assert.ok(items.results.length, 3);

                                            var message = items.results[1];
                                            assert.equal(message.id, message1.id);
                                            assert.equal(message.messageBoxId, message1.messageBoxId);
                                            assert.equal(message.threadKey, message1.threadKey);
                                            assert.equal(message.created, message1.created);
                                            assert.equal(message.replyTo, message1.replyTo);
                                            assert.notEqual(parseInt(message.deleted, 10), NaN);
                                            assert.ok(parseInt(message.deleted, 10) > parseInt(message.created, 10));
                                            assert.strictEqual(message.level, message1.level);
                                            assert.ok(!message.body);
                                            assert.ok(!message.createdBy);

                                            // Delete the rest of the messages to test hard-deletes. This also tests owner can delete
                                            RestAPI.Meetings.deleteMessage(memberUser.restContext, meeting.id, replyMessage1.created, function(err, message) {
                                                assert.ok(!err);
                                                assert.ok(!message);

                                                // We re-delete this one, but it should actually do a hard delete this time as there are no children
                                                RestAPI.Meetings.deleteMessage(memberUser.restContext, meeting.id, message1.created, function(err, message) {
                                                    assert.ok(!err);
                                                    assert.ok(!message);

                                                    // Perform a hard-delete on this leaf message. This also tests admins can delete
                                                    RestAPI.Meetings.deleteMessage(tenant.adminRestContext, meeting.id, message2.created, function(err, message) {
                                                        assert.ok(!err);
                                                        assert.ok(!message);

                                                        // There should be no more messages in the meeting as they should have all been de-indexed by hard deletes
                                                        RestAPI.Meetings.getMessages(managerUser.restContext, meeting.id, null, null, function(err, items) {
                                                            assert.ok(!err);
                                                            assert.ok(items);
                                                            assert.equal(items.results.length, 0);
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
        };

        /**
         * Test that verifies the logic of deleting messages, and the model and permissions for the operation
         */
        it('verify deleting meeting messages, model and permissions', function(callback) {
            MeetingsTestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {

                // Ensure permissions for deleting a message of a public meeting
                _assertDeleteMessagePermissions(publicTenant, publicTenant.privateUser, publicTenant.loggedinUser, publicTenant.publicUser, publicTenant.publicMeeting, function() {

                    // Ensure permissions for deleting a message of a loggedin meeting
                    _assertDeleteMessagePermissions(publicTenant, publicTenant.privateUser, publicTenant.loggedinUser, publicTenant.publicUser, publicTenant.loggedinMeeting, function() {

                        // Ensure permissions for deleting a message of a private meeting
                        return _assertDeleteMessagePermissions(publicTenant, publicTenant.privateUser, publicTenant.loggedinUser, publicTenant.publicUser, publicTenant.privateMeeting, callback);
                    });
                });
            });
        });
    });
});
