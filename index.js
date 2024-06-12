const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    const postCollection = client.db("post-portal").collection("posts");
    const commentCollection = client.db("post-portal").collection("comments");
    const paymentCollection = client.db("post-portal").collection("payments");
    const announcementCollection = client
      .db("post-portal")
      .collection("announcements");

    // middlewares
    const verifyToken = async (req, res, next) => {
      const token = req.cookies.token;
      if (!token) {
        return res.status(401).send({ message: "Unauthorized access!" });
      }
      jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
          console.log(err);
          return res.status(401).send({ message: "Unauthorized access!" });
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
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseInt(price) * 100;

      if (!price || priceInCent < 1) return;

      // generate intnst
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ client_secret });
    });

    // Payments Related Api
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne({
        ...payment,
        timestamp: Date.now(),
      });
      const query = { email: payment.user_email };
      const updateDoc = {
        $set: {
          subscription: "Gold",
        },
      };
      const userRes = await userCollection.updateOne(query, updateDoc);
      res.send(userRes);
    });

    // State related api
    app.get("/user-state/:email", async (req, res) => {
      const email = req.params.email;
      const result = await postCollection
        .aggregate([
          {
            $match: { user_email: email },
          },
          {
            $addFields: {
              totalVotes: {
                $add: [{ $size: "$upvotes" }, { $size: "$downvotes" }],
              },
            },
          },
          {
            $group: {
              _id: "$user_name",
              totalPost: { $sum: 1 },
              totalComment: { $sum: { $size: "$comments" } },
              totalVotes: { $sum: "$totalVotes" },
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // Post Related Api

    app.get("/post-ability/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const posts = await postCollection.find({ user_email: email }).toArray();
      if (user.subscription === "Bronze" && posts.length >= 5) {
        return res.send({ status: false });
      }
      res.send({ status: true });
    });

    app.get("/posts", async (req, res) => {
      const { tags } = req.query;
      let query = {};
      if (tags) {
        const tagsStrArr = tags?.split(",");
        // const tagsIdObjArr = tagsIdStrArr.map((id) => new ObjectId(id));
        query = {
          selectedTags: { $in: tagsStrArr },
        };
      }

      const result = await postCollection
        .aggregate([
          {
            $match: query,
          },
          // Extraticking the user
          {
            $addFields: {
              user_id: { $toObjectId: "$user_id" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "user_id",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: "$user",
          },
          // extracting selected tages
          {
            $unwind: "$selectedTags",
          },
          {
            $addFields: {
              selectedTags: { $toObjectId: "$selectedTags" },
            },
          },
          {
            $lookup: {
              from: "tags",
              localField: "selectedTags",
              foreignField: "_id",
              as: "selectedTags",
            },
          },
          {
            $unwind: "$selectedTags",
          },
          {
            $group: {
              _id: "$_id",
              user_name: { $first: "$user_name" },
              user_email: { $first: "$user_email" },
              post_title: { $first: "$post_title" },
              post_description: { $first: "$post_description" },
              selectedTags: { $push: "$selectedTags" },
              user_id: { $first: "$user_id" },
              user: { $first: "$user" },
              upvotes: { $first: "$upvotes" },
              downvotes: { $first: "$downvotes" },
              comments: { $first: "$comments" },
              posted: { $first: "$posted" },
            },
          },
          {
            $sort: { posted: -1 },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.get("/posts/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { user_email: email };
      const result = await postCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/posts-sort-popularity", async (req, res) => {
      const result = await postCollection
        .aggregate([
          {
            $addFields: {},
          },
        ])
        .toArray();
      res.send(result);
    });

    app.get("/post/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await postCollection
        .aggregate([
          {
            $match: query,
          },
          // Extraticking the user
          {
            $addFields: {
              user_id: { $toObjectId: "$user_id" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "user_id",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: "$user",
          },
          // extracting selected tages
          {
            $unwind: "$selectedTags",
          },
          {
            $addFields: {
              selectedTags: { $toObjectId: "$selectedTags" },
            },
          },
          {
            $lookup: {
              from: "tags",
              localField: "selectedTags",
              foreignField: "_id",
              as: "selectedTags",
            },
          },
          {
            $unwind: "$selectedTags",
          },
          {
            $group: {
              _id: "$_id",
              user_name: { $first: "$user_name" },
              user_email: { $first: "$user_email" },
              post_title: { $first: "$post_title" },
              post_description: { $first: "$post_description" },
              selectedTags: { $push: "$selectedTags" },
              user_id: { $first: "$user_id" },
              user: { $first: "$user" },
              upvotes: { $first: "$upvotes" },
              downvotes: { $first: "$downvotes" },
              comments: { $first: "$comments" },
              posted: { $first: "$posted" },
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    app.post("/posts", verifyToken, async (req, res) => {
      const post = req.body;
      const user = await userCollection.findOne({ email: post.user_email });
      const selectedTags = post.selectedTags.map((tag) => tag._id);

      const finalPost = {
        ...post,
        user_id: user._id.toString(),
        selectedTags,
        upvotes: [],
        downvotes: [],
        comments: [],
        posted: Date.now(),
      };
      const result = await postCollection.insertOne(finalPost);
      res.send(result);
    });

    // Votes related api
    app.post("/votes/:postId", async (req, res) => {
      const { postId } = req.params;
      const voteDetails = req.body;
      const query = { _id: new ObjectId(postId) };
      const option = { upsert: true };

      if (voteDetails.vote_type === "upvote") {
        const updateDoc = {
          $push: { upvotes: { user_email: voteDetails.user_email } },
        };
        const result = await postCollection.updateOne(query, updateDoc, option);
        return res.send(result);
      } else if (voteDetails.vote_type === "downvote") {
        const updateDoc = {
          $push: { downvotes: { user_email: voteDetails.user_email } },
        };
        const result = await postCollection.updateOne(query, updateDoc, option);
        return res.send(result);
      }
      res.send({
        message: "Please provide a 'vote_type' property on the request object",
      });
    });

    // Comments related api
    app.get("/comments/:postId", async (req, res) => {
      const { postId } = req.params;
      const query = { post_id: postId };
      const result = await commentCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $lookup: {
              from: "users",
              localField: "user_email",
              foreignField: "email",
              as: "user",
            },
          },
          {
            $unwind: "$user",
          },
        ])
        .toArray();
      res.send(result);
    });
    app.post("/comments", verifyToken, async (req, res) => {
      const comment = req.body;
      const result = await commentCollection.insertOne(comment);

      // Saving the comment Id to the post collecetion
      const query = { _id: new ObjectId(comment.post_id) };
      const updateDoc = {
        $push: {
          comments: result._id,
        },
      };
      const postResult = await postCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    app.get("/post-comments/:postId", async (req, res) => {
      const postId = req.params.postId;
      const query = { post_id: postId };
      const result = await commentCollection.find(query).toArray();
      res.send(result);
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
    app.get("/user/:email", verifyToken, async (req, res) => {
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

    // Announcement related api
    app.get("/announcements", async (req, res) => {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const result = await announcementCollection
        .find({ timestamp: { $gte: sevenDaysAgo } })
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });
    app.post("/announcements", verifyToken, verifyAdmin, async (req, res) => {
      const announcement = req.body;
      const result = await announcementCollection.insertOne({
        ...announcement,
        timestamp: Date.now(),
      });
      res.send(result);
    });

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
