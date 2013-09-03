/* jshint -W014, -W116 */
/* global process, unreachable */
/**
 * @preserve Copyright (c) 2013 Petka Antonov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:</p>
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
(function( global, Function, Array, Error ) { "use strict";

//This is the only way to have efficient constants












var errorObj = {};
var UNRESOLVED = {};
var noop = function(){};

function indexOf( array, value ) {
    for( var i = 0, len = array.length; i < len; ++i ) {
        if( value === array[i] ) {
            return i;
        }
    }
    return -1;
}

var isArray = Array.isArray || function( obj ) {
    //yeah it won't work iframes
    return obj instanceof Array;
};

//Try catch is not supported in optimizing
//compiler, so it is isolated
function tryCatch1( fn, receiver, arg ) {
    try {
        return fn.call( receiver, arg );
    }
    catch( e ) {
        if( Promise.errorHandlingMode ===
            Promise.ErrorHandlingMode.PROMISE_ONLY &&
            !( e instanceof PromiseError ) ) {
            throw e;
        }
        errorObj.e = e;
        return errorObj;
    }
}

function GetterCache(){}
function FunctionCache(){}


//If one uses sensible property names
//then the dummy constructor will give
//currently 8 more inobject properteis than
//EMPTY object literal in V8

//In other words, Promise.prototype.get
//is optimized for applications that use it
//for 1-8 properties that have identifier names
var getterCache = new GetterCache(),
    functionCache = new FunctionCache(),

    rescape = /[\r\n\u2028\u2029']/g,

    replacer = function( ch ) {
        return "\\u" + (("0000") +
            (ch.charCodeAt(0).toString(16))).slice(-4);
    },

    hasProp = {}.hasOwnProperty;

function getGetter( propertyName ) {
    if( hasProp.call( getterCache, propertyName ) ) {
        return getterCache[propertyName];
    }
    //The cache is intentionally broken for silly properties
    //that contain newlines or quotes or such
    propertyName = (""+propertyName).replace( rescape, replacer );
    var fn = new Function("obj", "return obj['"+propertyName+"'];");
    getterCache[propertyName] = fn;
    return fn;
}

function getFunction( propertyName ) {
    if( hasProp.call( getterCache, propertyName ) ) {
        return functionCache[propertyName];
    }
    propertyName = (""+propertyName).replace( rescape, replacer );
    var fn = new Function("obj", "return obj['"+propertyName+"']();");
    getterCache[propertyName] = fn;
    return fn;
}
//Ensure in-order async calling of functions
//with minimal use of async functions like setTimeout
var defer = (function() {

    var functionBuffer = new Array( 300 );
    for( var i = 0, len = functionBuffer.length; i < len; ++i ) {
        functionBuffer[i] = void 0;
    }

    var length = 0;
    var wasDeferred = false;

    function consumeFunctionBuffer() {
        var len = length;
        if( len > 0 ) {
            var copy = new Array(len);
            for( var i = 0, len = copy.length; i < len; ++i ) {
                copy[i] = functionBuffer[i];
                functionBuffer[i] = void 0;
            }
            reset();
            for( var i = 0; i < len; i += 3 ) {
                copy[ i + 0 ].call(
                    copy[ i + 1 ],
                    copy[ i + 2 ]
                );
            }
        }
        else reset();

    }

    function reset() {
        length = 0;
        wasDeferred = false;
    }

    var deferFn = typeof process !== "undefined" ?
            ( typeof global.setImmediate !== "undefined"
                ? function(){
                    global.setImmediate( consumeFunctionBuffer );
                  }
                : function() {
                    process.nextTick( consumeFunctionBuffer );
                }

            ) :
            ( typeof setTimeout !== "undefined"
                ? function() {
                    setTimeout( consumeFunctionBuffer, 4 );
                }
                : function() {
                    consumeFunctionBuffer();
                }
            ) ;



    return function( fn, receiver, arg ) {
        functionBuffer[ length + 0 ] = fn;
        functionBuffer[ length + 1 ] = receiver;
        functionBuffer[ length + 2 ] = arg;
        length += 3;
        if( !wasDeferred ) {
            deferFn();
            wasDeferred = true;
        }
    };

})();

var bindDefer = function( fn, receiver ) {
    return function( arg ) {
        defer( fn, receiver, arg );
    };
};

var PendingPromise = (function() {

/**
 * Deferred
 *
 *
 */
function PendingPromise( promise ) {
    this.promise = promise;
    this.fulfill = bindDefer( this.fulfill, this );
    this.reject = bindDefer( this.reject, this );
    this.update = bindDefer( this.update, this );
}
var method = PendingPromise.prototype;

method.toString = function() {
    return "[object PendingPromise]";
};

method.fulfill = function( value ) {
    this.promise._fulfill( value );
};

method.reject = function( value ) {
    this.promise._reject( value );
};

method.update = function( value ) {
    this.promise._update( value );
};




return PendingPromise;})();
var Promise = (function() {

function Promise( resolver ) {
    this._isCompleted = false;
    this._isFulfilled = false;
    this._isRejected = false;
    this._isCancellable = true;

    //Since most promises only have 0-1 handlers
    //store the first ones directly on the object
    this._fulfill0 =
    this._reject0 =
    this._update0 =
    this._promise0 =
    this._receiver0 =
        void 0;

    //store rest on array
    this._callbacks = null;
    this._callbacksLength = 0;

    //reason for rejection or fulfilled value
    this._completionValue = UNRESOLVED;

    if( typeof resolver === "function" ) {
        var len = resolver.length;
        var fulfill, reject, update;

        if( len > 0 ) fulfill = bindDefer( this._fulfill, this );
        if( len > 1 ) reject = bindDefer( this._reject, this );
        if( len > 2 ) update = bindDefer( this._update, this );

        resolver( fulfill, reject, update );
    }
}
var method = Promise.prototype;

method.toString = function() {
    return "[object Promise]";
};

method.fulfilled = function( fn, receiver ) {
    return this._then( fn, void 0, void 0, receiver );
};

method.rejected = function( fn, receiver ) {
    return this._then( void 0, fn, void 0, receiver );
};

method.updated = function( fn, receiver ) {
    return this._then( void 0, void 0, fn, receiver );
};

method.completed = function( fn, receiver ) {
    return this._then( fn, fn, void 0, receiver );
};

method.cancel = function( message, data ) {
    if( this.isCompleted() ) return;
    this._reject( new CancellationError( message, data ) );
};

method.call = function( propertyName ) {
    var len = arguments.length;

    if( len < 2 ) {
        return this._callFast( propertyName );
    }
    else {
        var args = new Array(len-1);
        for( var i = 1; i < len; ++i ) {
            args[ i - 1 ] = arguments[ i ];
        }
        return this._callSlow( propertyName, args );
    }

};

method.get = function( propertyName ) {
    return this.then( getGetter( propertyName ) );
};

method.then = function( didFulfill, didReject, didUpdate ) {
    return this._then( didFulfill, didReject, didUpdate, this );
};

method.isPending = function() {
    return !this.isCompleted();
};

method.isCompleted = function() {
    return this._isCompleted;
};

method.isFulfilled = function() {
    return this._isFulfilled;
};

method.isRejected = function() {
    return this._isRejected;
};

method._then = function( didFulfill, didReject, didUpdate, receiver ) {
    var ret = new Promise();
    var callbackIndex =
        this._addCallbacks( didFulfill, didReject, didUpdate, ret, receiver );

    if( this.isCompleted() ) {
        defer( this._completeLast, this, callbackIndex );
    }

    return ret;
};

method._callbackReceiverAt = function( index ) {
    if( index === 0 ) return this._receiver0;
    return this._callbacks[ index + 4 - 5 ];
};

method._callbackPromiseAt = function( index ) {
    if( index === 0 ) return this._promise0;
    return this._callbacks[ index + 3 - 5 ];
};

method._callbackFulfillAt = function( index ) {
    if( index === 0 ) return this._fulfill0;
    return this._callbacks[ index + 0 - 5 ];
};

method._callbackRejectAt = function( index ) {
    if( index === 0 ) return this._reject0;
    return this._callbacks[ index + 1 - 5 ];
};

method._callbackUpdateAt = function( index ) {
    if( index === 0 ) return this._update0;
    return this._callbacks[ index + 2 - 5 ];
};

method._addCallbacks = function( fulfill, reject, update, promise, receiver ) {
    fulfill = typeof fulfill === "function" ? fulfill : noop;
    reject = typeof reject === "function" ? reject : noop;
    update = typeof update === "function" ? update : noop;
    var index = this._callbacksLength | 0;

    if( index === 0 ) {
        this._fulfill0 = fulfill;
        this._reject0  = reject;
        this._update0 = update;
        this._promise0 = promise;
        this._receiver0 = receiver;
        this._callbacksLength = index + 5;
        return index;
    }

    var callbacks = this._callbacks;

    if( callbacks === null ) {
        callbacks = this._callbacks = new Array( 5 );
    }

    if( ( index + 5 ) >= callbacks.length ) {
        callbacks.length = callbacks.length + 5;
    }

    callbacks[ index - 5 + 0 ] = fulfill;
    callbacks[ index - 5 + 1 ] = reject;
    callbacks[ index - 5 + 2 ] = update;
    callbacks[ index - 5 + 3 ] = promise;
    callbacks[ index - 5 + 4 ] = receiver;
    this._callbacksLength = index + 5;
    return index;
};

method._callFast = function( propertyName ) {
    return this.then( getFunction( propertyName ) );
};

method._callSlow = function( propertyName, args ) {
    return this.then( function( obj ) {
        return obj[propertyName].apply( obj, args );
    });
};

method._completeLast = function( index ) {
    var promise = this._callbackPromiseAt( index );
    var receiver = this._callbackReceiverAt( index );
    var fn;

    if( this.isFulfilled() ) {
        fn = this._callbackFulfillAt( index );
    }
    else if( this.isRejected() ) {
        fn = this._callbackRejectAt( index );
    }
    else unreachable();

    var obj = this._completionValue;
    var ret = obj;

    if( fn !== noop ) {
        this._completePromise( fn, receiver, obj, promise );
    }
    else if( this.isFulfilled() ) {
        promise._fulfill( ret, false );
    }
    else {
        promise._reject( ret, false );
    }
};

method._completePromise = function( fn, receiver, value, promise2 ) {
    if( receiver === void 0 ) {
        receiver = this;
    }
    var ret = tryCatch1( fn, receiver, value );
    if( ret === errorObj ) {
        promise2._reject( errorObj.e );
    }
    else if( isPromise( ret ) ) {
        if( ret instanceof Promise ) {
            ret._then(
                promise2._fulfill,
                promise2._reject,
                void 0,
                promise2
            );
        }
        else {
            ret.then(
                bindDefer( promise2._fulfill, promise2 ),
                bindDefer( promise2._reject, promise2 )
            );
        }
    }
    else {
        promise2._fulfill( ret );
    }
};

method._completeFulfill = function( obj ) {
    var len = this._callbacksLength;
    for( var i = 0; i < len; i+= 5 ) {
        var fn = this._callbackFulfillAt( i );
        var promise = this._callbackPromiseAt( i );
        if( fn !== noop ) {
            this._completePromise(
                fn,
                this._callbackReceiverAt( i ),
                obj,
                promise
            );
        }
        else {
            promise._fulfill( obj );
        }
    }
};

method._completeReject = function( obj ) {
    var len = this._callbacksLength;
    for( var i = 0; i < len; i+= 5 ) {
        var fn = this._callbackRejectAt( i );
        var promise = this._callbackPromiseAt( i );
        if( fn !== noop ) {
            this._completePromise(
                fn,
                this._callbackReceiverAt( i ),
                obj,
                promise
            );
        }
        else {
            promise._reject( obj );
        }
    }
};



method._fulfill = function( obj ) {
    if( this.isCompleted() ) return;
    this._isCompleted = true;
    this._isFulfilled = true;
    this._completionValue = obj;
    this._completeFulfill( obj );
};

method._reject = function( obj ) {
    if( this.isCompleted() ) return;
    this._isCompleted = true;
    this._isRejected = true;
    this._completionValue = obj;
    this._completeReject( obj );
};

method._update = function( obj ) {
    if( this.isCompleted() ) return;
    var len = this._callbacksLength;
    for( var i = 0; i < len; i+= 5 ) {
        var fn = this._callbackUpdateAt( i );
        var promise = this._callbackPromiseAt( i );
        var ret = obj;
        if( fn !== noop ) {
            ret = tryCatch1( fn, this._callbackReceiverAt( i ), obj );
            if( ret === errorObj ) {
                this._reject( errorObj.e );
                return;
            }
        }
        promise._update( ret );
    }
};

function isPromise( value ) {
    if( value == null ) {
        return false;
    }
    return ( typeof value === "object" ||
            typeof value === "function" ) &&
        typeof value.then === "function";
}

Promise.is = isPromise;

Promise.when = function( promises ) {
    if( !isArray( promises ) ) {
        promises = [].slice.call( arguments );
    }
    var ret = Promise.pending();
    var len = promises.length;
    var values = new Array( promises.length );
    var total = 0;
    function succeed( val ) {
        values[ indexOf( promises, this ) ] = val;
        total++;
        if( total === len ) {
            ret.fulfill( values );
        }
    }
    function fail( reason ) {
        ret.reject( reason );
    }
    for( var i = 0; i < len; ++i ) {
        var promise = promises[i];
        promise.succeeded( succeed );
        promise.failed( fail );

    }
    return ret.promise;
};

Promise.fulfilled = function( value ) {
    var ret = new Promise();
    ret._fulfill( value );
    return ret;
};

Promise.rejected = function( value ) {
    var ret = new Promise();
    ret._reject( value );
    return ret;
};

Promise.pending = function() {
    return new PendingPromise( new Promise() );
};

return Promise;})();
var PromiseError = (function() {

PromiseError.prototype = new Error();
PromiseError.prototype.constructor = PromiseError;

function PromiseError( msg, data ) {
    if( typeof Error.captureStackTrace !== "undefined" ) {
        Error.captureStackTrace( this, this.constructor );
    }
    Error.apply( this, arguments );
    this.message = msg;
    this.data = data;
}

return PromiseError; })();
var CancellationError = (function() {

CancellationError.prototype = new PromiseError();
CancellationError.prototype.constructor = CancellationError;

function CancellationError() {
    PromiseError.apply( this, arguments );
    this.name = "cancel";
}


return CancellationError; })();
Promise.Error = PromiseError;
Promise.CancellationError = CancellationError;

Promise.ErrorHandlingMode = {
    ANY: {},
    PROMISE_ONLY: {}
};

Promise.errorHandlingMode = Promise.ErrorHandlingMode.ANY;
if( typeof module !== "undefined" && module.exports ) {
    module.exports = Promise;
}
else if( typeof define === "function" && define.amd ) {
    define( "Promise", [], function(){return Promise;});
}
else {
    global.Promise = Promise;
}


return Promise;})( new Function("return this")(), Function, Array, Error );