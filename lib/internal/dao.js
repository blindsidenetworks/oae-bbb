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
var ShortId = require('shortid');
var util = require('util');

var AuthzUtil = require('oae-authz/lib/util');
var Cassandra = require('oae-util/lib/cassandra');
var log = require('oae-logger').logger('oae-dao');
var OaeUtil = require('oae-util/lib/util');
var TenantsAPI = require('oae-tenants');

var Meeting = require('oae-bbb/lib/model').Meeting;

/**
 * Create a new meeting.
 *
 * @param  {String}     createdBy           The id of the user creating the meeting
 * @param  {String}     displayName         The display name of the meeting
 * @param  {String}     [description]       A longer description for the meeting
 * @param  {String}     [record]       		Flag indicating that the meeting may be recorded
 * @param  {String}     [allModerators]     Flag indicating that all users join as moderators
 * @param  {String}     [waitModerator]     Flag indicating that viewers must wait until a moderator joins
 * @param  {String}     [visibility]        The visibility of the meeting. One of public, loggedin, private. Defaults to the configured tenant default.
 * @param  {Object}     [opts]              Additional optional parameters
 * @param  {Number}     [opts.created]      When the meeting was created. If unspecified, will use the current timestamp
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The meeting object that was created
 */
var createMeeting = module.exports.createMeeting = function(createdBy, displayName, description, record, allModerators, waitModerator, visibility, opts, callback) {
    opts = opts || {};

    var created = opts.created || Date.now();
    created = created.toString();

    var tenantAlias = AuthzUtil.getPrincipalFromId(createdBy).tenantAlias;
    var meetingId = _createMeetingId(tenantAlias);
    var storageHash = {
        'tenantAlias': tenantAlias,
        'createdBy': createdBy,
        'displayName': displayName,
        'description': description,
        'record': record,
        'allModerators': allModerators,
        'waitModerator': waitModerator,
        'visibility': visibility,
        'created': created,
        'lastModified': created
    };

    var query = Cassandra.constructUpsertCQL('Meetings', 'id', meetingId, storageHash);
    Cassandra.runQuery(query.query, query.parameters, function(err) {
        if (err) {
        	console.info(err);
            return callback(err);
        }

        return callback(null, _storageHashToMeeting(meetingId, storageHash));
    });
};

/**
 * Update the basic profile of the specified meeting.
 *
 * @param  {Meeting} meeting          The meeting to update
 * @param  {Object}     profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The updated meeting object
 */
var updateMeeting = module.exports.updateMeeting = function(meeting, profileFields, callback) {
    var storageHash = _.extend({}, profileFields);
    storageHash.lastModified = storageHash.lastModified || Date.now();
    storageHash.lastModified = storageHash.lastModified.toString();

    console.info('UPDATE');
    console.info(storageHash);
    var query = Cassandra.constructUpsertCQL('Meetings', 'id', meeting.id, storageHash);
    console.info(query);
    Cassandra.runQuery(query.query, query.parameters, function(err) {
        if (err) {
        	console.info('ERROR');
        	console.info(err);
            return callback(err);
        }

        return callback(null, _createUpdatedMeetingFromStorageHash(meeting, storageHash));
    });
};

/**
 * Get a meeting basic profile by its id.
 *
 * @param  {String}     meetingId        The id of the meeting to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Meeting} callback.meeting The meeting object requested
 */
var getMeeting = module.exports.getMeeting = function(meetingId, callback) {
    getMeetingsById([meetingId], null, function(err, meetings) {
        if (err) {
            return callback(err);
        }

        return callback(null, meetings[0]);
    });
};


/**
 * Delete a meeting profile by its id.
 * This will *NOT* remove the meeting from the members their libraries.
 *
 * @param  {String}     meetingId        The id of the meeting to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
var deleteMeeting = module.exports.deleteMeeting = function(meetingId, callback) {
    log().info({'meetingId': meetingId}, 'Meeting deleted');
    Cassandra.runQuery('DELETE FROM "Meetings" WHERE "id" = ?', [meetingId], callback);
};

/**
 * Get multiple meetings by their ids
 *
 * @param  {String[]}       meetingIds           The ids of the meetings to get
 * @param  {String[]}       [fields]                The meeting fields to select. If unspecified, selects all of them
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Meeting[]}   callback.meetings    The meeting objects requested, in the same order as the meeting ids
 */
var getMeetingsById = module.exports.getMeetingsById = function(meetingIds, fields, callback) {
    if (_.isEmpty(meetingIds)) {
        return callback(null, []);
    }

    var query = null;
    var parameters = [];

    // If `fields` was specified, we select only the fields specified. Otherwise we select all (i.e., *)
    if (fields) {
        var columns = _.map(fields, function(field) {
            return util.format('"%s"', field);
        });

        query = util.format('SELECT %s FROM "Meetings" WHERE "id" IN (?)', columns.join(','));
    } else {
        query = 'SELECT * FROM "Meetings" WHERE "id" IN (?)';
    }

    parameters.push(meetingIds);

    console.info(query);
    console.info(parameters);
    Cassandra.runQuery(query, parameters, function(err, rows) {
    	console.info(rows);
        if (err) {
            return callback(err);
        }

        // Convert the retrieved storage hashes into the Meeting model
        var meetings = {};
        _.chain(rows).map(Cassandra.rowToHash).each(function(row) {
            meetings[row.id] = _storageHashToMeeting(row.id, row);
        });

        // Order the meetings according to the array of meeting ids
        var orderedMeetings = _.map(meetingIds, function(meetingId) {
            return meetings[meetingId];
        });

        console.info(orderedMeetings);
        return callback(null, orderedMeetings);
    });
};

/**
 * Iterate through all the meetings. This will return just the raw meeting properties that are specified in the `properties`
 * parameter, and only `batchSize` meetings at a time. On each iteration of `batchSize` meetings, the `onEach` callback
 * will be invoked, and the next batch will not be fetched until you have invoked the `onEach.done` function parameter. When
 * complete (e.g., there are 0 meetings left to iterate through or an error has occurred), the `callback` parameter will be
 * invoked.
 *
 * @param  {String[]}   [properties]            The names of the meeting properties to return in the meeting objects. If not specified (or is empty array), it returns just the `meetingId`s
 * @param  {Number}     [batchSize]             The number of meetings to fetch at a time. Defaults to 100
 * @param  {Function}   onEach                  Invoked with each batch of meetings that are fetched from storage
 * @param  {Object[]}   onEach.meetingRows   An array of objects holding the raw meeting rows that were fetched from storage
 * @param  {Function}   onEach.done             The function to invoke when processing of the current batch is complete
 * @param  {Object}     onEach.done.err         An error that occurred, if any, while processing the current batch. If you specify this error, iteration will finish and the completion callback will be invoked
 * @param  {Function}   [callback]              Invoked when all rows have been iterated, or an error has occurred
 * @param  {Object}     [callback.err]          An error that occurred, while iterating rows, if any
 * @see Cassandra#iterateAll
 */
var iterateAll = module.exports.iterateAll = function(properties, batchSize, onEach, callback) {
    if (_.isEmpty(properties)) {
        properties = ['id'];
    }

    /*!
     * Handles each batch from the cassandra iterateAll method
     *
     * @see Cassandra#iterateAll
     */
    var _iterateAllOnEach = function(rows, done) {
        // Convert the rows to a hash and delegate action to the caller onEach method
        return onEach(_.map(rows, Cassandra.rowToHash), done);
    };

    Cassandra.iterateAll(properties, 'Meetings', 'id', {'batchSize': batchSize}, _iterateAllOnEach, callback);
};

/**
 * Create a meeting model object from its id and the storage hash.
 *
 * @param  {String}     meetingId    The id of the meeting
 * @param  {Object}     hash            A simple object that represents the stored meeting object
 * @return {Meeting}                 The meeting model object. Returns `null` if this does not represent an existing meeting
 * @api private
 */
var _storageHashToMeeting = function(meetingId, hash) {
    return new Meeting(
        TenantsAPI.getTenant(hash.tenantAlias),
        meetingId,
        hash.createdBy,
        hash.displayName,
        hash.description,
        hash.record,
        hash.allModerators,
        hash.waitModerator,
        hash.visibility,
        OaeUtil.getNumberParam(hash.created),
        OaeUtil.getNumberParam(hash.lastModified)
    );
};

/**
 * Create an updated meeting object from the provided one, with updates from the provided storage hash
 *
 * @param  {Meeting}     meeting  The meeting object to update
 * @param  {Object}         hash        A simple object that represents stored fields for the meeting
 * @return {Meeting}                 The updated meeting object
 * @api private
 */
var _createUpdatedMeetingFromStorageHash = function(meeting, hash) {
    return new Meeting(
        meeting.tenant,
        meeting.id,
        meeting.createdBy,
        hash.displayName || meeting.displayName,
        hash.description || meeting.description,
        hash.visibility || meeting.visibility,
        OaeUtil.getNumberParam(meeting.created),
        OaeUtil.getNumberParam(hash.lastModified || meeting.lastModified)
    );
};

/**
 * Generate a new unique meeting id
 *
 * @param  {String}     tenantAlias     The tenant for which to to generate the id
 * @return {String}                     A unique meeting resource id
 * @api private
 */
var _createMeetingId = function(tenantAlias) {
    return AuthzUtil.toId('d', tenantAlias, ShortId.generate());
};
