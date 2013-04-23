var util = require('util'),
    activationFns = require('./activation')

var DEFAULT_OPTS = {
    layers: [ 3 ],
    weight: 0.1,
    iterations: 2000,
    errorThresh: 0.005,
    activation: 'logistic',
    learningRate: 0.3,
    momentum: 0.1,
    bias: 0.1,
    log: 0  // how many iterations to log training progress after. 0 = never, 10 = log every 10 iterations.
}

module.exports = function (opts) {
    return new NN(opts)
}

/**
 * NN class (implements a feedforward neural network)
 * 
 * @param {Object} opts
 */
function NN (opts) {
    var self = this

    // normalize opts and choose sane defaults
    this.mergeOpts(opts)

    // this is a 2D matrix representing our layers of neurons
    this.layers =  [];

    // 1 input layer, 1 output layer, and the hidden layers
    this.numLayers = 2 + this.opts.layers.length

    // populate hidden layers with neurons
    // input and output layers left empty - setup upon training
    this.setupHiddenLayers()
}

NN.prototype.train = function (trainingData) {
    if (!Array.isArray(trainingData)) {
        trainingData = [ trainingData ]
    }

    var self = this
    var input = trainingData[0].input
    var desiredOutput = trainingData[0].output

    // add output layer if not existing
    if (!this.outputLayer) {
        this.setupOutputLayer(desiredOutput)
    }

    this.changes = [];

    var iterations = this.opts.iterations
    var totalIterations = 0
    var error = 1

    while (totalIterations++ < iterations && error > this.opts.errorThresh) {

        // run through the training data
        trainingData.forEach(function (trainingEntry, index) {
            var input = trainingEntry.input
            var desiredOutput = trainingEntry.output

            // propagate `input` forward thru the layers
            var output = self.send(input)

            // run the back-propagation learning algo
            self.backPropagate(desiredOutput)
        })

        // log training progress
        if (self.opts.log && totalIterations%self.opts.log === 0) {
            
            var cumError = 0

            // determine MSE of all training entries
            trainingData.forEach(function (trainingEntry) {
                var output = self.send(trainingEntry.input)
                cumError += self.mse(trainingEntry.output, output)
            })

            error = cumError / trainingData.length

            console.log('nn: iteration %s. MSE: %s.', totalIterations, error)
            // self.print()
        }
    }
}

/**
 * Propagate `input` thru the neural net, and 
 * populate this.outputs
 * 
 * @param  {Array or Object} input
 */
NN.prototype.send = function (input) {
    var self = this
    
    if (!this.inputLayerSetup) {
        this.setupInputLayer(input)
        this.inputLayerSetup = true
    }

    // keep track of the outputs of each neuron
    this.outputs = [];

    // keep track of net inputs to each neuron for back-propagation algo
    this.netInput = [];

    // set output of first (input) layer
    this.outputs[0] = input

    for (var layer = 1; layer < this.numLayers; layer++) {
        var numNodes = this.weights[layer].length

        this.outputs[layer] = [];
        this.netInput[layer] = [];

        var prevLayerOutput = this.outputs[layer - 1];

        // send each neuron input
        for (var n = 0; n < numNodes; n++) {

            // keep track of the net inputs to each neuron for BPL algo
            self.netInput[layer][n] = this.biases[layer][n];

            // add weighted sum of previous layer's output * this layer's weights
            prevLayerOutput.forEach(function (prevOut, p) {
                self.netInput[layer][n] += prevOut * self.weights[layer][n][p]
            })

            var response = activationFns[this.opts.activation].activate(self.netInput[layer][n])
            
            this.outputs[layer][n] = response

            // console.log('nn: Send: L%s:N%s. netInput: %s, output: %s', layer, n, self.netInput[layer][n], response)
        }
    }

    // return output of last layer
    return this.outputs[this.outputs.length - 1]
}

NN.prototype.backPropagate = function (desiredOutput) {
    var self = this
    this.errorSigs = [];

    var outputLayerIndex = this.outputs.length - 1;
    var outputLayer = this.outputs[outputLayerIndex];
    var prevLayerOutput = this.outputs[outputLayerIndex - 1];
    
    var numOutputNodes = outputLayer.length

    this.errorSigs[outputLayerIndex] = [];

    // initialize changes array if needed
    if (!this.changes[outputLayerIndex])
        this.initializeChanges();

    // update weights for output layer
    for (var n = 0; n < numOutputNodes; n++) {

        var desiredOut = desiredOutput[n];
        var neuronOut = outputLayer[n];
        var neuronError = desiredOut - neuronOut;

        // determine error signal value
        var errorSig = neuronError * neuronOut * (1 - neuronOut)
        self.errorSigs[outputLayerIndex][n] = errorSig

        // update neuron connection weights
        for (var p = 0; p < prevLayerOutput.length; p++) {
            var change = self.changes[outputLayerIndex][n][p];
            var weightDelta = self.opts.learningRate * errorSig * prevLayerOutput[p];

            change = weightDelta + (self.opts.momentum * change)

            // console.log('change', change)

            // console.log('L%s:N%s neuronError %s desiredOut %s, neuronOut %s, errorSig: %s, p: %s, prevOut: %s, change for p: %s', outputLayerIndex, n, neuronError, desiredOut, neuronOut, errorSig, p, prevOut, change)
            this.weights[outputLayerIndex][n][p] += change
            this.changes[outputLayerIndex][n][p] = change
        }

        // update neuron bias
        var biasDelta = self.opts.learningRate * errorSig

        this.biases[outputLayerIndex][n] += biasDelta
    }

    var lastHiddenLayerNum = outputLayerIndex - 1

    // iterate backwords thru the rest of the hidden layers
    for (var layer = lastHiddenLayerNum; layer > 0; layer--) {

        var prevLayerOutput = this.outputs[layer - 1];
        var nextLayerSize = this.outputs[layer + 1].length;

        this.errorSigs[layer] = [];

        // determine error of each neuron's output
        for (var n = 0; n < this.outputs[layer].length; n++) {
            var neuronOut = this.outputs[layer][n];

            // determine weighted sum of next layer's errorSigs
            var nextLayerErrorSum = 0

            // determine errors for each connection to this neuron
            for (var d = 0; d < nextLayerSize; d++) {
                nextLayerErrorSum += this.errorSigs[layer + 1][d] * (self.weights[layer + 1][d][n] || 0)
            }
            
            // determine error sig value for this neuron
            var errorSig = nextLayerErrorSum * neuronOut * (1 - neuronOut)

            this.errorSigs[layer][n] = errorSig

            // console.log('hidden layer L%s:N%s errorSig: %s, netInput: %s', layer, n, errorSig, netInput)

            // update neuron connection weights
            for (var p = 0; p < prevLayerOutput.length; p++) {
                var change = this.changes[layer][n][p];

                var weightDelta = this.opts.learningRate * errorSig * prevLayerOutput[p];

                change = weightDelta + (this.opts.momentum * change)
                
                // console.log('change hidden layer L%s:N%s:p:%s : %s', layer, n, p, change)

                this.weights[layer][n][p] += change;
                this.changes[layer][n][p] = change;
            }

            // update neuron bias
            this.biases[layer][n] += this.opts.learningRate * errorSig
        }
    }
}

/**
 * Calculates Mean-Squared Error between a `desiredOutput` array and
 * the actual `output` array generated by the NN instance.
 * 
 * @param  {Array} desiredOutput 
 * @param  {Array} output      
 * @return {Number}               MSE error value
 */
NN.prototype.mse = function (desiredOutput, output) {
    var mse = 0

    desiredOutput.forEach(function (desiredOut, index) {
        var rawError = desiredOut - (output[index] || 0)
        mse += Math.pow(rawError, 2)
    })

    return mse / desiredOutput.length
}

NN.prototype.initializeChanges = function () {
    var self = this
    this.changes = [];

    var numLayers = this.outputs.length

    this.changes.push([])

    this.outputs.slice(1).forEach(function (layer, index) {
        self.changes.push(layer.map(function (node) {
            var ret = [];

            var prevSize = self.outputs[index].length

            for (var i = 0; i < prevSize; i++) {
                ret.push(0)
            }

            return ret
        }))
    })
}

NN.prototype.setupInputLayer = function (input) {
    var firstHiddenLayerIndex = 1
    var numIncoming = input.length
    var numNodes = this.opts.layers[0]

    this.biases[firstHiddenLayerIndex] = [];
    this.weights[firstHiddenLayerIndex] = [];

    for (var n = 0; n < numNodes; n++) {
        this.biases[firstHiddenLayerIndex][n] = this.opts.bias
        this.weights[firstHiddenLayerIndex][n] = [];

        for (var i = 0; i < numIncoming; i++) {
            this.weights[firstHiddenLayerIndex][n][i] = this.opts.weight   
        }
    }
}

NN.prototype.setupOutputLayer = function (desiredOutput) {
    var outputLayerIndex = this.numLayers - 1

    var numIncoming = this.opts.layers[this.opts.layers.length - 1]
    var numOutputNodes = desiredOutput.length

    this.biases[outputLayerIndex] = [];
    this.weights[outputLayerIndex] = [];

    for (var n = 0; n < numOutputNodes; n++) {
        this.biases[outputLayerIndex][n] = this.opts.bias

        // initialize weights for this layer's connections to prev layer
        this.weights[outputLayerIndex][n] = [];

        for (var i = 0; i < numIncoming; i++) {
            this.weights[outputLayerIndex][n][i] = this.opts.weight
        }
    }
}

NN.prototype.setupHiddenLayers = function () {
    this.biases = [];
    this.weights = [];

    var optLayers = this.opts.layers

    // initialize each hidden layer - leave first layer
    // empty to use as input layer
    for (var layer = 0; layer < optLayers.length; layer++) {
        var numNodes = optLayers[layer];

        this.biases[layer + 1] = [];
        this.weights[layer + 1] = [];

        // setup biases for this hideen layer
        for (var n = 0; n < numNodes; n++) {
            this.biases[layer + 1][n] = this.opts.bias
        }

        // don't setup first hidden layer until we have training input
        // that way we can tailor the network to the training data.
        if (layer > 0) {
            var numIncoming = optLayers[layer - 1]

            for (var n = 0; n < numNodes; n++) {
                this.weights[layer + 1][n] = [];

                for (var i = 0; i < numIncoming; i++) {
                    this.weights[layer + 1][n][i] = this.opts.weight
                }
            }
        }
    }

}

NN.prototype.mergeOpts = function (opts) {
    var self = this
    var optionKeys = Object.keys(DEFAULT_OPTS)

    this.opts = {}

    optionKeys.forEach(function (key) {
        if (typeof opts[key] === 'undefined')
            self.opts[key] = DEFAULT_OPTS[key];
        else
            self.opts[key] = opts[key];      
    })

    if (!Array.isArray(this.opts.layers))
        throw new Error('nn: opts.layers must be an array. Got: '+opts.layers)
}

NN.prototype.print = function () {
    console.log('weights:', util.inspect(this.weights, false, 10, true))
    console.log('biases:', util.inspect(this.biases, false, 10, true))
}
