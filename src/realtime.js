import { Server } from "socket.io";

function wrap(middleware) {
  return (socket, next) => middleware(socket.request, {}, next);
}

export function createRealtimeServer(server, sessionMiddleware) {
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.use(wrap(sessionMiddleware));
  io.use((socket, next) => {
    const user = socket.request.session?.user;
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.request.session.user;
    socket.join(`role:${user.role}:${user.id}`);
    socket.join(`role:${user.role}`);

    if (user.role === "admin") {
      socket.join("admins");
    }

    socket.on("ride:watch", (rideId) => {
      if (rideId) {
        socket.join(`ride:${rideId}`);
      }
    });

    socket.on("ride:unwatch", (rideId) => {
      if (rideId) {
        socket.leave(`ride:${rideId}`);
      }
    });
  });

  function emitToUser(role, id, event, payload) {
    io.to(`role:${role}:${id}`).emit(event, payload);
  }

  function emitToAdmins(event, payload) {
    io.to("admins").emit(event, payload);
  }

  function emitToRide(rideId, event, payload) {
    io.to(`ride:${rideId}`).emit(event, payload);
  }

  return {
    io,
    emitToUser,
    emitToAdmins,
    emitToRide
  };
}
