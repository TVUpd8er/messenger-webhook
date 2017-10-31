# TV Upd8er Messenger Webhook

Technologies
 - Node.js
 - Firebase
 - dialogflow
 - TVMaze

A Facebook Messenger bot that keeps you up to date on all your TV shows by reminding you when a new episode airs. Allows you to subscribe to your favourite shows, learn information about the show, and can even recommend you new shows based on the shows you love.

Built using the Facebook Messenger platform, and api.ai was used as an NLP platform which allowed us to make our bot more capable and a bit more human.

NodeJS and Firebase were used as a backend to store user data. Heroku was used as a webhook for the Messenger bot, and was also used as a middle man between api.ai and the Messenger bot itself, which determined the various responses and actions. 

Notification scheduling was handled by Heroku Scheduler and Moment.js.

For scheduling information and miscellaneous information about various TV shows, we used the TVMaze API, which gave us access to pretty much everything we needed.

The recommendation feature was powered by TasteDive, which allowed us to find TV shows that were similar to the ones specified by the user.

This project was built for Hack the North 2017!
