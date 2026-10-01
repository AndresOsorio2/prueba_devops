// Lightweight factory to mock a Mongoose Model without touching a real DB.
let idCounter = 0;

function createMockModel() {
  const MockModel = jest.fn().mockImplementation(function (data) {
    const payload = { _id: `mock-id-${++idCounter}`, ...data };
    Object.assign(this, payload);
    this.save = jest.fn().mockResolvedValue(this);
    this.deleteOne = jest.fn().mockResolvedValue(this);
    this.toObject = jest.fn().mockReturnValue({ ...payload });
    return this;
  });

  MockModel.find = jest.fn();
  MockModel.findOne = jest.fn();
  MockModel.findById = jest.fn();
  MockModel.countDocuments = jest.fn();
  MockModel.deleteMany = jest.fn();
  MockModel.findByIdAndDelete = jest.fn();
  MockModel.aggregate = jest.fn();

  return MockModel;
}

module.exports = createMockModel;

