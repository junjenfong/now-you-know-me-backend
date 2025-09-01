Your backend needs to handle the POST request to  
 /api/sessions/:sessionId/start. In that request handler, you should:
_ Update the session's status in your database to "playing".  
 _ Broadcast the gameStarted event to all connected clients for that
session via your WebSocket server.
