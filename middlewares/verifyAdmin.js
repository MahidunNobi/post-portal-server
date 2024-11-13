const verifyAdmin = async (req, res, next) => {
  const user = req.user;
  const query = { email: user?.email };
  const userResult = await userCollection.findOne(query);
  if (!userResult || userResult.role !== "admin") {
    return res.status(401).send({ message: "Unauthorized access!" });
  }
  next();
};

module.exports = verifyAdmin;
