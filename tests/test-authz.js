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

var assert = require('assert');

var Context = require('oae-context').Context;
var TestsUtil = require('oae-tests');

var MeetingsAPI = require('oae-bbbs');

describe('Meetings Authz', function() {

    var anonymousContext = null;

    beforeEach(function() {
        anonymousContext = new Context(global.oaeTests.tenants.cam);
    });

    describe('#canManageMeeting', function() {

        /**
         * Test that verifies anonymous users cannot manage a meeting
         */
        it('verify anonymous cannot manage a meeting', function(callback) {
            // The actual meeting doesn't matter, as it should know immediately that anonymous cannot manage
            MeetingsAPI.Authz.canManageMeeting(anonymousContext, {}, function(err, canManage) {
                assert.ok(!err);
                assert.ok(!canManage);
                return callback();
            });
        });
    });

    describe('#canShareMeeting', function() {

        /**
         * Test that verifies anonymous users cannot share a meeting
         */
        it('verify anonymous cannot share a meeting', function(callback) {
            // The actual meeting doesn't matter, as it should know immediately that anonymous cannot share
            MeetingsAPI.Authz.canShareMeeting(anonymousContext, {}, [], function(err, canShare) {
                assert.ok(!err);
                assert.ok(!canShare);
                return callback();
            });
        });
    });

    describe('#canPostMeetingMessage', function(callback) {

        /**
         * Test that verifies anonymous users cannot post a meeting message
         */
        it('verify anonymous cannot post a meeting message', function(callback) {
            // The actual meeting doesn't matter, as it should know immediately that anonymous cannot post
            MeetingsAPI.Authz.canPostMeetingMessage(anonymousContext, {}, function(err, canPost) {
                assert.ok(!err);
                assert.ok(!canPost);
                return callback();
            });
        });
    });

    describe('#canDeleteMeetingMessage', function(callback) {

        /**
         * Test that verifies anonymous users cannot delete a meeting message
         */
        it('verify anonymous cannot delete a meeting message', function(callback) {
            // The actual meeting and message doesn't matter, as it should know immediately that anonymous cannot delete
            MeetingsAPI.Authz.canDeleteMeetingMessage(anonymousContext, {}, {}, function(err, canDelete) {
                assert.ok(!err);
                assert.ok(!canDelete);
                return callback();
            });
        });
    });
})