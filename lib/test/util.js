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

var assert = require('assert');
var ShortId = require('shortid');
var util = require('util');

var LibraryAPI = require('oae-library');
var RestAPI = require('oae-rest');
var SearchTestUtil = require('oae-search/lib/test/util');
var TestsUtil = require('oae-tests/lib/util');

/**
 * Set up 2 public tenants and 2 private tenants, each with a public, loggedin, private set of users and
 * meetings. The resulting model looks like:
 *
 * ```
 *  {
 *      "publicTenant": {
 *          "tenant": <Tenant>,
 *          "anonymousRestContext": <RestContext>,
 *          "adminRestContext": <RestCOntext> (of the tenant admin),
 *          "publicMeeting": <Meeting>,
 *          "loggedinMeeting": <Meeting>,
 *          "privateMeeting": <Meeting>,
 *          "publicUser": {
 *              "user": <User>,
 *              "restContext": <RestContext>
 *          },
 *          "loggedinUser": { ... }
 *          "privateUser": { ... }
 *      },
 *      "publicTenant1": { ... },
 *      "privateTenant": { ... },
 *      "privateTenant1": { ... }
 *  }
 * ```
 *
 * @param  {Function}   Invoked when all the entities are set up
 * @throws {Error}      An assertion error is thrown if something does not get created properly
 */
var setupMultiTenantPrivacyEntities = module.exports.setupMultiTenantPrivacyEntities = function(callback) {
    // Create the tenants and users
    TestsUtil.setupMultiTenantPrivacyEntities(function(publicTenant, publicTenant1, privateTenant, privateTenant1) {
        // Create the meetings.
        _setupTenant(publicTenant, function() {
            _setupTenant(publicTenant1, function() {
                _setupTenant(privateTenant, function() {
                    _setupTenant(privateTenant1, function() {
                        return callback(publicTenant, publicTenant1, privateTenant, privateTenant1);
                    });
                });
            });
        });
    });
};

/**
 * Create the meetings within a tenant.
 *
 * @param  {Tenant}     tenant          The tenant to setup
 * @param  {Function}   callback        Standard callback function
 * @throws {Error}                      An assertion error is thrown if something does not get created properly
 * @api private
 */
var _setupTenant = function(tenant, callback) {
    _createMultiPrivacyMeetings(tenant.adminRestContext, function(publicMeeting, loggedinMeeting, privateMeeting) {
        tenant.publicMeeting = publicMeeting;
        tenant.loggedinMeeting = loggedinMeeting;
        tenant.privateMeeting = privateMeeting;
        callback();
    });
};

/**
 * Set up meetings of all privacies using the given rest context
 *
 * @param  {RestContext}    restCtx         The rest context to use
 * @param  {Function}       callback        Standard callback function
 * @throws {Error}                          An assertion error is thrown if something does not get created properly
 * @api private
 */
var _createMultiPrivacyMeetings = function(restCtx, callback) {
    _createMeetingWithVisibility(restCtx, 'public', function(publicMeeting) {
        _createMeetingWithVisibility(restCtx, 'loggedin', function(loggedinMeeting) {
            _createMeetingWithVisibility(restCtx, 'private', function(privateMeeting) {
                return callback(publicMeeting, loggedinMeeting, privateMeeting);
            });
        });
    });
};

/**
 * Create a meeting with the specified visibility
 *
 * @param  {RestContext}    restCtx             The rest context to use
 * @param  {String}         visibility          The visibility of the user
 * @param  {Function}       callback            Standard callback function
 * @param  {Meeting}     callback.meeting The meeting that was created
 * @throws {Error}                              An assertion error is thrown if something does not get created properly
 * @api private
 */
var _createMeetingWithVisibility = function(restCtx, visibility, callback) {
    var randomId = util.format('%s-%s', visibility, ShortId.generate());
    RestAPI.Meetings.createMeeting(restCtx, 'displayName-' + randomId, 'description-' + randomId, visibility, null, null, function(err, meeting) {
        assert.ok(!err);
        return callback(meeting);
    });
};

/**
 * Update a meeting, ensuring that the request succeeds
 *
 * @param  {RestContext}    restContext             The REST context with which to update the meeting
 * @param  {String}         dicussionId             The id of the meeting to update
 * @param  {Object}         updates                 An object keyed by field name, whose values are either the new value to assign to the field
 * @param  {Function}       callback                Invoked when the meeting has been successfully updated
 * @param  {Meeting}     callback.meeting     The updated meeting
 * @throws {AssertionError}                         Thrown if the request fails
 */
var assertUpdateMeetingSucceeds = module.exports.assertUpdateMeetingSucceeds = function(restContext, meetingId, updates, callback) {
    RestAPI.Meetings.updateMeeting(restContext, meetingId, updates, function(err, meeting) {
        assert.ok(!err);

        // Wait for library and search to be udpated before continuing
        LibraryAPI.Index.whenUpdatesComplete(function() {
            SearchTestUtil.whenIndexingComplete(function() {
                return callback(meeting);
            });
        });
    });
};


/**
 * Update the members of a meeting, ensuring that the request succeeds
 *
 * @param  {RestContext}    restContext     The REST context with which to update the members
 * @param  {String}         dicussionId     The id of the meeting whose members to update
 * @param  {Object}         updates         An object keyed by principal id, whose values are either the role to assign or `false` to indicate that the principal should be removed
 * @param  {Function}       callback        Invoked when the members have been successfully updated
 * @throws {AssertionError}                 Thrown if the request fails
 */
var assertUpdateMeetingMembersSucceeds = module.exports.assertUpdateMeetingMembersSucceeds = function(restContext, meetingId, updates, callback) {
    RestAPI.Meetings.updateMeetingMembers(restContext, meetingId, updates, function(err) {
        assert.ok(!err);

        // Wait for library and search to be udpated before continuing
        LibraryAPI.Index.whenUpdatesComplete(function() {
            return SearchTestUtil.whenIndexingComplete(callback);
        });
    });
};
