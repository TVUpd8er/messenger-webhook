/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request'),
  apiai = (require('apiai'))('d12606fdc0294197b2fb80b3d90b095b'),
  firebase = require('firebase'),
  sanitizeHtml = require('sanitize-html'),
  moment = require('moment');


var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

// Initialize Firebase
var fbconfig = {
    apiKey: "AIzaSyDgjHO606F-nd6TvmsRwlWPB7_zeVYBN_Y",
    authDomain: "tv-upd8er-329cf.firebaseapp.com",
    databaseURL: "https://tv-upd8er-329cf.firebaseio.com",
    projectId: "tv-upd8er-329cf",
    storageBucket: "tv-upd8er-329cf.appspot.com",
    messagingSenderId: "1089291010810"
};

firebase.initializeApp(fbconfig);
var db = firebase.database();

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  firebase_init_user(senderID);

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  var userProfile;

  console.log('https://graph.facebook.com/v2.6/' + senderID + '?access_token=' + PAGE_ACCESS_TOKEN);
  request({json: true, url: 'https://graph.facebook.com/v2.6/' + senderID + '?access_token=' + PAGE_ACCESS_TOKEN}, function(e, r, body) {
    if(!e) {
      userProfile = body;
      processMessage(messageText, senderID, userProfile, messageAttachments);
    } else {
      console.log('Access to user profile API failed');
    }
  });
}

function processMessage(messageText, senderID, userProfile, messageAttachments) {
  if(messageText) {
    var request = apiai.textRequest(messageText, {
      sessionId: senderID.toString() // use any arbitrary id
    });

    request.on('response', (response) => {
      // Got a response from api.ai. Let's POST to Facebook Messenger
      let aiText = response.result.fulfillment.speech;
      console.log('Received response from api.ai: \'' + aiText + '\'');
      if(aiText.length < 0) console.log('Received empty string back!');
      if(aiText.charAt(0) == '+') {
        subscribe(senderID, aiText.substr(1));
      } else if(aiText.charAt(0) == '-') {
        unsubscribe(senderID, aiText.substr(1));
      } else if(aiText.charAt(0) == '=') {
        summary(senderID, aiText.substr(1));
      } else if(aiText.charAt(0) == '>') {
        cast(senderID, aiText.substr(1));
      } else if(aiText.charAt(0) == '~') {
        recommendations(senderID,aiText.substr(1));
      }else sendTextMessage(senderID, aiText);
    });

    request.on('error', (error) => {
      console.log(error);
    });

    request.end();
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}

/* Subscribes to a show
*/

function getShowByIDCallback(id, callback) {
  request({json: true, url: 'http://api.tvmaze.com/shows/' + id}, function(e, r, body) {
    callback(body);
  });
}

function getShowByNameCallback(name, callback) {
  request({json: true, url: 'http://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(name)}, function(e, r, body) {
    callback(body);
  });
}

function notifications () {
  db.ref().once('value', function(snapshot) {
    snapshot.forEach(function(childSnapshot) {
      // for each users subs
      var childKey = childSnapshot.key;
      var sub_ref = db.ref ().child (childKey).child('subs');
      console.log ('check sub_ref: ' + sub_ref);

      sub_ref.once('value', function(snapshot2) {
        snapshot2.forEach(function(childSnapshot2) {
          // for each users tv shows subbed to
          // Next episode
          var last_notification = childSnapshot2.val();
          nextEpisode(childSnapshot2.key, function(obj) {
            if(obj != null) {
              if(obj.airdate.length === 0) {
                // no airdate, ignore
              }
              else {
                var air_moment = moment (obj.airdate + ' ' + obj.airtime);
                var send_notifications_at = [moment(air_moment).subtract(7, 'days'), moment(air_moment).subtract(1, 'days'),
                                            moment(air_moment).hour(0).minute(0).second(0), moment(air_moment).add(1, 'days')];
                
                for (var x = 0; x < send_notifications_at.length; x++) {
                  if (moment ().isSameOrAfter (send_notifications_at[x])) {
                    if (moment(last_notification, 'MMMM Do YYYY, h:mm:ss a').isBefore(send_notifications_at[x])) {
                        // last notification was sent before the time to send it, you should prolly send one
                        getShowByNameCallback(name, function(show_callback) {
                          if (show_callback != null) {
                            var msg = 'Don\'t forget to watch the latest episode of ' + show_callback.name + ' in ' + moment().to(air_moment) + ' 😮';
                            var msg2 = 'The latest episode of ' + show_callback.name + ' aired yesterday. Just making sure you didn\'t forget 😉';
                            sendTextMessage(childKey, x == 3 ? msg2 : msg);
                            sub_ref.child(childSnapshot2.key).remove();
                            sub_ref.child(childSnapshot2.key).push(moment().format("MMMM Do YYYY, h:mm:ss a"));
                          } else {
                            console.log('Access to TasteDive API failed');
                          }
                        });
                      break;
                    }
                  }
                  else {
                    // too early to send one
                  }
                }
              }
            }
            else {
             // sendTextMessage(senderID, 'Couldn\'t find the next episode for ' + show_callback.name);
            }
          });
        })
      });
    });
  });
}

function recommendations(senderID, name) {
  //https://tastedive.com/api/similar?k=284343-TVUpd8r-ZCKD529J&limit=20&type=show&q=show%3Amodern%20family
  getShowByNameCallback(name, function(show_callback) {
    if (show_callback != null) {
      var url = 'https://tastedive.com/api/similar?k=284343-TVUpd8r-ZCKD529J&limit=20&type=show&q=show%3A' + encodeURIComponent(show_callback.name);

      request({json: true, url: url}, function(e, r, body) {
        if(!e) {
          var lst = new Array();

          body.Similar.Results.forEach(function(element) {
            lst.push(element.Name);
          });

          var msg = '';

          for (var i = 0; i < Math.min (5, lst.length); i++) {
            msg += lst[i] += (i == (Math.min (5, lst.length) - 2) ? ' and ' : (i == (Math.min (5, lst.length) - 1) ? '' : ', '));
          }
          var msg2 = lst.length == 0 ? 'There aren\'t any shows like ' + show_callback.name + ' 😳' : 'You like ' + show_callback.name + '? Hope you like these ones ✨';
          sendTextMessage(senderID, msg2);

          if (lst.length != 0) {
            sendTextMessage(senderID,msg);
          }
        } else {
          console.log('Access to TasteDive failed');
          console.log('Access to casts failed.');
        }
      });
    } else {
      console.log('Access to TasteDive API failed');
      sendTextMessage(senderID, 'Sorry, I couldn\'t find that show 😞');
    }
  });
}

function subscribe(senderID, name) {
  getShowByNameCallback(name, function(show_callback) {
    if(show_callback != null) {
      sendTextMessage(senderID, 'You\'ve been subscribed to ' + show_callback.name + ' 🎉');
      firebase_subscribe(senderID, show_callback.id, moment().format("MMMM Do YYYY, h:mm:ss a"));

      // Next episode
      nextEpisode(show_callback.id, function(obj) {
        if(obj != null) {
          if(obj.airdate.length === 0) sendTextMessage(senderID, 'The next episode is \'' + obj.name + '\' but the air date is TBA. ⏰');
          else sendTextMessage(senderID, 'The next episode is \'' + obj.name + '\' and will air in ' + moment().to(obj.airdate + ' ' + obj.airtime));
        } else {
          sendTextMessage(senderID, 'Couldn\'t find the next episode for ' + show_callback.name + ' 😳');
        }
      });
    } else {
      console.log('Access to TVMaze API failed');
      sendTextMessage(senderID, 'Sorry, I couldn\'t find that show 😞');
    }
  });
}

/* Unsubscribes from a show
*/

function unsubscribe(senderID, name) {
  getShowByNameCallback(name, function(show_callback) {
    if (show_callback != null) {
      sendTextMessage(senderID, 'Unsubscribing from \'' + show_callback.name + '\'. Sorry to see you go 😞');
      firebase_unsubscribe(senderID, show_callback.id);
    } else {
      console.log('Access to TVMaze API failed');
      sendTextMessage(senderID, 'Sorry, I couldn\'t find that show 😞');
    }
  });
}

/* Send a summary of the episode
*/

function summary(senderID, name) {
  getShowByNameCallback(name, function(show_callback) {
    if (show_callback != null) {
      var summ = sanitizeHtml(show_callback.summary, {allowedTags: [], allowedAttributes: []});
      summ = summ.replace(/&quot;/g, '\"');
      sendTextMessage(senderID, 'I should warn you about spoilers 🤐');
      sendTextMessage(senderID, summ);
      sendImageMessage(senderID,show_callback.image.medium)
    } else {
      console.log('Access to TVMaze API failed');
      sendTextMessage(senderID, 'Sorry, I couldn\'t find that show 😞');
    }
  });
}

/* Send the cast list
*/

function cast(senderID, name) {
  getShowByNameCallback(name, function(show_callback) {
    if (show_callback != null) {
      request({json: true, url: 'http://api.tvmaze.com/shows/' + show_callback.id + '/cast'}, function(e, r, body) {
        if(!e) {
          //sendTextMessage(senderID, 'Here are the main cast members:')
          var lst = new Array();

          body.forEach(function(element) {
            lst.push(element.person.name);
          });

          var msg = '';

          for (var i = 0; i < Math.min (5, lst.length); i++) {
            msg += lst[i] += (i == (Math.min (5, lst.length) - 2) ? ' and ' : (i == (Math.min (5, lst.length) - 1) ? '' : ', '));
          }

          sendTextMessage(senderID,msg);
        } else {
          console.log('Access to TVMaze Cast API failed');
          console.log('Access to casts failed.');
        }
      });
    } else {
      console.log('Access to TVMaze API failed');
      sendTextMessage(senderID, 'Sorry, I couldn\'t find that show 😞');
    }
  });
}

/* Finds the time of the next episode
*/
function nextEpisode(id, callback) {
  request({json: true, url: 'http://api.tvmaze.com/shows/' + id + '/episodes?specials=1'}, function(e, r, body) {
    if(!e && body != null) {
      var next = null;
      body.forEach(function(element) {
        //console.log(moment().format('YYYY-MM-DD') + ' ' + element.airdate);
        if(next === null) {
          if(element.airdate.length != 0 && element.airtime.length != 0 && moment().isSameOrBefore(element.airdate + ' ' + element.airtime) ||
              element.airdate.length === 0)
          next = element;
        }
      });
      callback(next);
    } else {
      console.log('Access to TVMaze episodes API failed');
    }
  });
}

function userExistsCallback(userId, exists) {
  if (!exists) {
	   db.ref().child(userId).set(userId);
  }
}

// Tests to see if /users/<userId> has any data.
function firebase_init_user(userId) {
  db.ref().child(userId).once('value', function(snapshot) {
    var exists = (snapshot.val() !== null);
    userExistsCallback(userId, exists);
  });
}

function firebase_subscribe(userId, showId, last_time) {
	db.ref().child(userId).child('subs').child(showId).remove();
  db.ref().child(userId).child('subs').child(showId).push(last_time);
}

function firebase_unsubscribe(userId, showId) {
	db.ref().child(userId).child('subs').child(showId).remove();
}

function firebase_get_notifications(userId, showId, notifications) {
    db.ref().child(userId).child('subs').child(showId).update(notifications);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, address) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: address
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/instagram_logo.gif"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: SERVER_URL + "/assets/sample.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a file using the Send API.
 *
 */
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

function initial_greeting () {
  var messageData = {
    setting_type: "greeting",
    greeting: {
      text: "Hey {{user_first_name}}! My goal is to make sure you never miss another episode of your favourite TV show ever!"
    }
  };
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

module.exports.notification = function() {
  notifications();
};
