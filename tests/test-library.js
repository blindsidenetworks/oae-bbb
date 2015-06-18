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

var LibraryAPI = require('oae-library');
var RestAPI = require('oae-rest');
var TestsUtil = require('oae-tests');

var MeetingsDAO = require('oae-bbb/lib/internal/dao');
var MeetingsTestUtil = require('oae-bbb/lib/test/util');

describe('Meeting libraries', function() {

    /**
     * Checks a principal library.
     *
     * @param  {RestContext}    restCtx         The context to use to do the request
     * @param  {String}         libraryOwnerId  The principal for which to retrieve the library
     * @param  {Boolean}        expectAccess    Whether or not retrieving the library should be successfull
     * @param  {Meeting[]}   expectedItems   The expected meetings that should return
     * @param  {Function}       callback        Standard callback function
     */
    var checkLibrary = function(restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {
        RestAPI.Meetings.getMeetingsLibrary(restCtx, libraryOwnerId, null, null, function(err, items) {
            if (!expectAccess) {
                assert.equal(err.code, 401);
                assert.ok(!items);
            } else {
                assert.ok(!err);

                // Make sure only the expected items are returned.
                assert.equal(items.results.length, expectedItems.length);
                _.each(expectedItems, function(expectedMeeting) {
                    assert.ok(_.filter(items.results, function(meeting) { return meeting.id === expectedMeeting.id; }));
                });
            }
            callback();
        });
    };

    /**
     * Creates a user and fills his library with meeting items.
     *
     * @param  {RestContext}    restCtx                         The context with which to create the user and content
     * @param  {String}         userVisibility                  The visibility for the new user
     * @param  {Function}       callback                        Standard callback function
     * @param  {User}           callback.user                   The created user
     * @param  {Meeting}     callback.privateMeeting      The private meeting
     * @param  {Meeting}     callback.loggedinMeeting     The loggedin meeting
     * @param  {Meeting}     callback.publicMeeting       The public meeting
     */
    var createUserAndLibrary = function(restCtx, userVisibility, callback) {
        // Create a user with the proper visibility
        TestsUtil.generateTestUsers(restCtx, 1, function(err, users) {
            var user = _.values(users)[0];
            RestAPI.User.updateUser(user.restContext, user.user.id, {'visibility': userVisibility}, function(err) {
                assert.ok(!err);

                // Fill up this user his library with 3 meeting items.
                RestAPI.Meetings.createMeeting(user.restContext, 'name', 'description', 'private', null, null, function(err, privateMeeting) {
                    assert.ok(!err);
                    RestAPI.Meetings.createMeeting(user.restContext, 'name', 'description', 'loggedin', null, null, function(err, loggedinMeeting) {
                        assert.ok(!err);
                        RestAPI.Meetings.createMeeting(user.restContext, 'name', 'description', 'public', null, null, function(err, publicMeeting) {
                            assert.ok(!err);
                            callback(user, privateMeeting, loggedinMeeting, publicMeeting);
                        });
                    });
                });
            });
        });
    };

    /**
     * Creates a group with the supplied visibility and fill its library with 3 meetings.
     *
     * @param  {RestContext}    restCtx                         The context with which to create the group and discusion
     * @param  {String}         groupVisibility                 The visibility for the new group
     * @param  {Function}       callback                        Standard callback function
     * @param  {Group}          callback.group                  The created group
     * @param  {Meeting}     callback.privateMeeting      The private meeting
     * @param  {Meeting}     callback.loggedinMeeting     The loggedin meeting
     * @param  {Meeting}     callback.publicMeeting       The public meeting
     */
    var createGroupAndLibrary = function(restCtx, groupVisibility, callback) {
        RestAPI.Group.createGroup(restCtx, 'displayName', 'description', groupVisibility, 'no', [], [], function(err, group) {
            assert.ok(!err);

            // Fill up the group library with 3 meeting items.
            RestAPI.Meetings.createMeeting(restCtx, 'name', 'description', 'private', [group.id], null, function(err, privateMeeting) {
                assert.ok(!err);
                RestAPI.Meetings.createMeeting(restCtx, 'name', 'description', 'loggedin', [group.id], null, function(err, loggedinMeeting) {
                    assert.ok(!err);
                    RestAPI.Meetings.createMeeting(restCtx, 'name', 'description', 'public', [group.id], null, function(err, publicMeeting) {
                        assert.ok(!err);
                        callback(group, privateMeeting, loggedinMeeting, publicMeeting);
                    });
                });
            });

        });
    };

    var camAnonymousRestCtx = null;
    var camAdminRestCtx = null;
    var gtAnonymousRestCtx = null;
    var gtAdminRestCtx = null;

    beforeEach(function() {
        camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        gtAnonymousRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
        gtAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    });

    /**
     * A testcase that the correct library stream is returned and the library user's visibility
     * settings are respected.
     */
    it('verify user libraries', function(callback) {
        // We'll create a private, loggedin and public user, each user's library will contain a private, loggedin and public meeting item.
        createUserAndLibrary(camAdminRestCtx, 'private', function(privateUser, privateUserPrivateMeeting, privateUserLoggedinMeeting, privateUserPublicMeeting) {
            createUserAndLibrary(camAdminRestCtx, 'loggedin', function(loggedinUser, loggedinUserPrivateMeeting, loggedinUserLoggedinMeeting, loggedinUserPublicMeeting) {
                createUserAndLibrary(camAdminRestCtx, 'public', function(publicUser, publicUserPrivateMeeting, publicUserLoggedinMeeting, publicUserPublicMeeting) {

                    // Each user should be able to see all the items in his library.
                    checkLibrary(privateUser.restContext, privateUser.user.id, true, [privateUserPublicMeeting, privateUserLoggedinMeeting, privateUserPrivateMeeting], function() {
                        checkLibrary(loggedinUser.restContext, loggedinUser.user.id, true, [loggedinUserPublicMeeting, loggedinUserLoggedinMeeting, loggedinUserPrivateMeeting], function() {
                            checkLibrary(publicUser.restContext, publicUser.user.id, true, [publicUserPublicMeeting, publicUserLoggedinMeeting, publicUserPrivateMeeting], function() {

                                // The anonymous user can only see the public stream of the public user.
                                checkLibrary(camAnonymousRestCtx, publicUser.user.id, true, [publicUserPublicMeeting], function() {
                                    checkLibrary(camAnonymousRestCtx, loggedinUser.user.id, false, [], function() {
                                        checkLibrary(camAnonymousRestCtx, privateUser.user.id, false, [], function() {

                                            checkLibrary(gtAnonymousRestCtx, publicUser.user.id, true, [publicUserPublicMeeting], function() {
                                                checkLibrary(gtAnonymousRestCtx, loggedinUser.user.id, false, [], function() {
                                                    checkLibrary(gtAnonymousRestCtx, privateUser.user.id, false, [], function() {

                                                        // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin user.
                                                        TestsUtil.generateTestUsers(camAdminRestCtx, 1, function(err, users) {
                                                            var anotherUser = _.values(users)[0];
                                                            checkLibrary(anotherUser.restContext, publicUser.user.id, true, [publicUserPublicMeeting, publicUserLoggedinMeeting], function() {
                                                                checkLibrary(anotherUser.restContext, loggedinUser.user.id, true, [loggedinUserPublicMeeting, loggedinUserLoggedinMeeting], function() {
                                                                    checkLibrary(anotherUser.restContext, privateUser.user.id, false, [], function() {

                                                                        // A loggedin user on *another* tenant can only see the public stream for the public user.
                                                                        TestsUtil.generateTestUsers(gtAdminRestCtx, 1, function(err, users) {
                                                                            var otherTenantUser = _.values(users)[0];
                                                                            checkLibrary(otherTenantUser.restContext, publicUser.user.id, true, [publicUserPublicMeeting], function() {
                                                                                checkLibrary(otherTenantUser.restContext, loggedinUser.user.id, false, [], function() {
                                                                                    checkLibrary(otherTenantUser.restContext, privateUser.user.id, false, [], function() {

                                                                                        // The cambridge tenant admin can see all the things.
                                                                                        checkLibrary(camAdminRestCtx, publicUser.user.id, true, [publicUserPublicMeeting, publicUserLoggedinMeeting, publicUserPrivateMeeting], function() {
                                                                                            checkLibrary(camAdminRestCtx, loggedinUser.user.id, true, [loggedinUserPublicMeeting, loggedinUserLoggedinMeeting, loggedinUserPrivateMeeting], function() {
                                                                                                checkLibrary(camAdminRestCtx, privateUser.user.id, true, [privateUserPublicMeeting, privateUserLoggedinMeeting, privateUserPrivateMeeting], function() {

                                                                                                    // The GT tenant admin can only see the public stream for the public user.
                                                                                                    checkLibrary(gtAdminRestCtx, publicUser.user.id, true, [publicUserPublicMeeting], function() {
                                                                                                        checkLibrary(gtAdminRestCtx, loggedinUser.user.id, false, [], function() {
                                                                                                            checkLibrary(gtAdminRestCtx, privateUser.user.id, false, [], callback);
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
            });
        });
    });

    /**
     * A testcase that the correct library stream is returned for a group.
     */
    it('verify group libraries', function(callback) {
        // Create three groups: private, loggedin, public
        TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users) {
            assert.ok(!err);
            var groupCreator = _.values(users)[0];
            var anotherUser = _.values(users)[1];
            createGroupAndLibrary(groupCreator.restContext, 'private', function(privateGroup, privateGroupPrivateMeeting, privateGroupLoggedinMeeting, privateGroupPublicMeeting) {
                createGroupAndLibrary(groupCreator.restContext, 'loggedin', function(loggedinGroup, loggedinGroupPrivateMeeting, loggedinGroupLoggedinMeeting, loggedinGroupPublicMeeting) {
                    createGroupAndLibrary(groupCreator.restContext, 'public', function(publicGroup, publicGroupPrivateMeeting, publicGroupLoggedinMeeting, publicGroupPublicMeeting) {

                        // An anonymous user can only see the public stream for the public group.
                        checkLibrary(camAnonymousRestCtx, publicGroup.id, true, [publicGroupPublicMeeting], function() {
                            checkLibrary(camAnonymousRestCtx, loggedinGroup.id, false, [], function() {
                                checkLibrary(camAnonymousRestCtx, privateGroup.id, false, [], function() {

                                    checkLibrary(gtAnonymousRestCtx, publicGroup.id, true, [publicGroupPublicMeeting], function() {
                                        checkLibrary(gtAnonymousRestCtx, loggedinGroup.id, false, [], function() {
                                            checkLibrary(gtAnonymousRestCtx, privateGroup.id, false, [], function() {

                                                // A loggedin user on the same tenant can see the loggedin stream for the public and loggedin group.
                                                checkLibrary(anotherUser.restContext, publicGroup.id, true, [publicGroupPublicMeeting, publicGroupLoggedinMeeting], function() {
                                                    checkLibrary(anotherUser.restContext, loggedinGroup.id, true, [loggedinGroupPublicMeeting, loggedinGroupLoggedinMeeting], function() {
                                                        checkLibrary(anotherUser.restContext, privateGroup.id, false, [], function() {

                                                            // A loggedin user on *another* tenant can only see the public stream for the public user.
                                                            TestsUtil.generateTestUsers(gtAdminRestCtx, 1, function(err, users) {
                                                                var otherTenantUser = _.values(users)[0];
                                                                checkLibrary(otherTenantUser.restContext, publicGroup.id, true, [publicGroupPublicMeeting], function() {
                                                                    checkLibrary(otherTenantUser.restContext, loggedinGroup.id, false, [], function() {
                                                                        checkLibrary(otherTenantUser.restContext, privateGroup.id, false, [], function() {


                                                                            // The cambridge tenant admin can see all the things.
                                                                            checkLibrary(camAdminRestCtx, publicGroup.id, true, [publicGroupPublicMeeting, publicGroupLoggedinMeeting, publicGroupPrivateMeeting], function() {
                                                                                checkLibrary(camAdminRestCtx, loggedinGroup.id, true, [loggedinGroupPublicMeeting, loggedinGroupLoggedinMeeting, loggedinGroupPrivateMeeting], function() {
                                                                                    checkLibrary(camAdminRestCtx, privateGroup.id, true, [privateGroupPrivateMeeting, privateGroupLoggedinMeeting, privateGroupPrivateMeeting], function() {

                                                                                        // The GT tenant admin can only see the public stream for the public user.
                                                                                        checkLibrary(gtAdminRestCtx, publicGroup.id, true, [publicGroupPublicMeeting], function() {
                                                                                            checkLibrary(gtAdminRestCtx, loggedinGroup.id, false, [], function() {
                                                                                                checkLibrary(gtAdminRestCtx, privateGroup.id, false, [], function() {

                                                                                                    // If we make the cambridge user a member of the private group he should see everything.
                                                                                                    var changes = {};
                                                                                                    changes[anotherUser.user.id] = 'member';
                                                                                                    RestAPI.Group.setGroupMembers(groupCreator.restContext, privateGroup.id, changes, function(err) {
                                                                                                        assert.ok(!err);
                                                                                                        checkLibrary(anotherUser.restContext, privateGroup.id, true, [privateGroupPrivateMeeting, privateGroupLoggedinMeeting, privateGroupPrivateMeeting], function() {

                                                                                                            // If we make the GT user a member of the private group, he should see everything.
                                                                                                            changes = {};
                                                                                                            changes[otherTenantUser.user.id] = 'member';
                                                                                                            RestAPI.Group.setGroupMembers(groupCreator.restContext, privateGroup.id, changes, function(err) {
                                                                                                                assert.ok(!err);
                                                                                                                checkLibrary(otherTenantUser.restContext, privateGroup.id, true, [privateGroupPrivateMeeting, privateGroupLoggedinMeeting, privateGroupPrivateMeeting], callback);
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
                });
            });
        });
    });

    /**
     * Test that verifies when user permissions are set on a meeting, the meeting is properly added into their library
     */
    it('verify setting permissions of meeting results in meeting showing up in the user\'s library', function(callback) {
        TestsUtil.generateTestUsers(camAdminRestCtx, 2, function(err, users, mrvisser, nicolaas) {
            assert.ok(!err);

            // Create a meeting as mrvisser
            RestAPI.Meetings.createMeeting(mrvisser.restContext, 'name', 'descr', 'public', null, null, function(err, meeting) {
                assert.ok(!err);

                // Seed mrvisser's and nicolaas' meeting libraries to ensure it does not get built from scratch
                RestAPI.Meetings.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, null, null, function(err, result) {
                    assert.ok(!err);
                    RestAPI.Meetings.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, null, null, function(err, result) {
                        assert.ok(!err);

                        // Make nicolaas a member of the meeting
                        var memberUpdates = {};
                        memberUpdates[nicolaas.user.id] = 'member';
                        MeetingsTestUtil.assertUpdateMeetingMembersSucceeds(mrvisser.restContext, meeting.id, memberUpdates, function(err) {
                            assert.ok(!err);

                            // Ensure the meeting is still in mrvisser's and nicolaas' meeting libraries
                            RestAPI.Meetings.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, null, null, function(err, result) {
                                assert.ok(!err);
                                var libraryEntry = result.results[0];
                                assert.ok(libraryEntry);
                                assert.strictEqual(libraryEntry.id, meeting.id);

                                RestAPI.Meetings.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, null, null, function(err, result) {
                                    assert.ok(!err);
                                    var libraryEntry = result.results[0];
                                    assert.ok(libraryEntry);
                                    assert.strictEqual(libraryEntry.id, meeting.id);
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
     * Test that verifies that a library can be rebuilt from a dirty authz table
     */
    it('verify a library can be rebuilt from a dirty authz table', function(callback) {
        createUserAndLibrary(camAdminRestCtx, 'private', function(simong, privateMeeting, loggedinMeeting, publicMeeting) {

            // Ensure all the items are in the user's library
            checkLibrary(simong.restContext, simong.user.id, true, [privateMeeting, loggedinMeeting, publicMeeting], function() {

                // Remove a meeting through the DAO. This will leave a pointer
                // in the Authz table that points to nothing. The library re-indexer
                // should be able to deal with this
                MeetingsDAO.deleteMeeting(privateMeeting.id, function(err) {
                    assert.ok(!err);

                    // Purge the library so that it has to be rebuild on the next request
                    LibraryAPI.Index.purge('meetings:meetings', simong.user.id, function(err) {
                        assert.ok(!err);

                        // We should be able to rebuild the library on-the-fly. The private
                        // meeting item should not be returned as it has been removed
                        checkLibrary(simong.restContext, simong.user.id, true, [loggedinMeeting, publicMeeting], callback);
                    });
                });
            });
        });
    });
});
