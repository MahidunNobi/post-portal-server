const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

// middleware
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("Post pulse server is going on here....");
});

const cookieOption = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db("post-portal").collection("users");
    const tagCollection = client.db("post-portal").collection("tags");

    // middlewares
    const verifyToken = async (req, res, next) => {
      const token = req.cookies.token;
      if (!token) {
        return res.status(401).send({ message: "Unauthrized access!" });
      }
      jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
          console.log(err);
          return res.status(401).send({ message: "Unauthrized access!" });
        }
        req.user = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const userResult = await userCollection.findOne(query);
      if (!userResult || userResult.role !== "admin") {
        return res.status(401).send({ message: "Unauthorized access!" });
      }
      next();
    };

    // jwt related token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "1hr",
      });
      res.cookie("token", token, cookieOption).send({ succcess: true });
    });
    app.get("/logout", (req, res) => {
      res
        .clearCookie("token", { ...cookieOption, maxAge: 0 })
        .send({ success: true });
    });

    // Posts Related api
    app.post("/posts", verifyToken, async (req, res) => {
      const post = req.body;
      console.log(post);
      res.send(post);
    });

    // Tags related api
    app.get("/tags", async (req, res) => {
      const result = await tagCollection.find().toArray();
      res.send(result);
    });

    // User related api's
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const query = req.query;
      // if (query) {
      //   const cursor = userCollection.find({ $text: { $search: query.name } });
      //   const result = await cursor.toArray();
      //   return res.send(result);
      // }
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.json({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne({
        ...user,
        subscription: "Bronze",
        timestamp: Date.now(),
      });
      res.send(result);
    });
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    app.post("/user-role", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const updateDoc = {
        $set: { role: user.role },
      };

      const result = await userCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // app.get("/user-by-name/:name", async())

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running of port ${port}`);
});
