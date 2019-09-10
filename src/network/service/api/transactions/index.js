const crypto = require('crypto');
const ed = require('ed25519');
const bignum = require('@ddn/bignum-utils');
const { AssetTypes } = require('@ddn/ddn-utils');

/**
 * RootRouter接口
 * wangxm   2019-03-21
 */
class RootRouter {

    constructor(context) {
        Object.assign(this, context);
        this._context = context;
    }

    async get(req) {
        var query = Object.assign({}, req.body, req.query);
        var validateErrors = await this.ddnSchema.validate({
            type: "object",
            properties: {
                blockId: {
                    type: "string"
                },
                limit: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100
                },
                type: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100
                },
                orderBy: {
                    type: "string"
                },
                offset: {
                    type: "integer",
                    minimum: 0
                },
                senderPublicKey: {
                    type: "string",
                    format: "publicKey"
                },
                ownerPublicKey: {
                    type: "string",
                    format: "publicKey"
                },
                ownerAddress: {
                    type: "string"
                },
                senderId: {
                    type: "string"
                },
                recipientId: {
                    type: "string"
                },
                amount: {
                    type: "string"
                },
                fee: {
                    type: "string"
                },
                aob: {
                    type: "integer",
                    minimum: 0,
                    maximum: 1
                },
                currency: {
                    type: "string",
                    minimum: 1,
                    maximum: 22
                },
                and:{
                    type:"integer",
                    minimum: 0,
                    maximum: 1
                }
            }
        }, query);
        if (validateErrors) {
            throw new Error(validateErrors[0].message);
        }

        var where = {};
        var andWheres = [];
        if (query.blockId) {
            andWheres.push({
                "block_id": query.blockId
            });
        }
        if (query.senderPublicKey) {
            andWheres.push({
                "sender_public_key": query.senderPublicKey
            });
        }
        if (query.senderId) {
            andWheres.push({
                "sender_id": query.senderId
            });
        }
        if (query.recipientId) {
            andWheres.push({
                "recipient_id": {
                    "$like": query.recipientId
                }                
            });
        }
        if (query.ownerAddress && query.ownerPublicKey) {
            andWheres.push({
                "$or": [
                    {
                        "sender_public_key": query.ownerPublicKey
                    },
                    {
                        "recipient_id": query.ownerAddress
                    }
                ]
            });
        } else if (query.ownerAddress) {
            andWheres.push({
                "$or": [
                    {
                        "sender_id": query.ownerAddress
                    },
                    {
                        "recipient_id": query.ownerAddress
                    }
                ]
            });
        }
        if (query.type >= 0) 
        {
            andWheres.push({
                "type": query.type
            });
        } 
        else if (query.aob) 
        {
            //wxm TODO 此处不应该有具体类型，资产类型是动态配置的，这种应该在对应的aob包里实现独立的接口
            // fields_or.push('(type >=9 and type <= 14)')
        }
        if (query.message) {
            andWheres.push({
                "message": query.message
            });
        }
        if (andWheres.length > 0) {
            where["$and"] = andWheres;
        }
        
        var limit = query.limit || 100;
        var offset = query.offset || 0;

        var data =  await this.runtime.dataquery.queryFullTransactionData(where, limit, offset, null, true);

        var transactions = [];
        for (var i = 0; i < data.transactions.length; i++) {
            var row = data.transactions[i];
            var trs = await this.runtime.transaction.serializeDbData2Transaction(row);
            transactions.push(trs);
        }

        return {
            success: true,
            transactions,
            count: data.count
        }
    }

    async getGet(req) {
        var query = Object.assign({}, req.body, req.query);
        var validateErrors = await this.ddnSchema.validate({
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    minLength: 1
                }
            },
            required: ['id']
        }, query);
        if (validateErrors) {
            throw new Error(validateErrors[0].message);
        }

        var rows =  await this.runtime.dataquery.queryFullTransactionData({id: query.id}, 1, 0, null);
        if (rows && rows.length) {
            var result = [];
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var trs = await this.runtime.transaction.serializeDbData2Transaction(row);
                result.push(trs);
            }

            return {
                success: true, 
                transaction: result[0]
            };
        } else {
            throw new Error("Transaction not found");
        }
    }

    async put(req) {
        var body = req.body;
        var validateErrors = await this.ddnSchema.validate({
            type: "object",
            properties: {
                secret: {
                    type: "string",
                    minLength: 1,
                    maxLength: 100
                },
                amount: {
                    type: "string"
                },
                recipientId: {
                    type: "string",
                    minLength: 1
                },
                publicKey: {
                    type: "string",
                    format: "publicKey"
                },
                secondSecret: {
                    type: "string",
                    minLength: 1,
                    maxLength: 100
                },
                multisigAccountPublicKey: {
                    type: "string",
                    format: "publicKey"
                },
                message: {
                    type: "string",
                    maxLength: 256
                }
            },
            required: ["secret", "amount", "recipientId"]
        }, body);
        if (validateErrors) {
            throw new Error(validateErrors[0].message);
        }

        var hash = crypto.createHash('sha256').update(body.secret, 'utf8').digest();
        var keypair = ed.MakeKeypair(hash);
        if (body.publicKey) {
            if (keypair.publicKey.toString('hex') != body.publicKey) {
                throw new Error("Invalid passphrase");
            }
        }

        return new Promise((resolve, reject) => {
            this.balancesSequence.add(async (cb) => {
                var recipient;
                try
                {
                    recipient = await this.runtime.account.getAccountByAddress(body.recipientId);
                }
                catch (err)
                {
                    return cb(err);
                }

                var recipientId = recipient ? recipient.address : body.recipientId;
                if (!recipientId) {
                    return cb("Recipient not found");
                }

                if (body.multisigAccountPublicKey && body.multisigAccountPublicKey != keypair.publicKey.toString('hex')) {
                    var account;
                    try
                    {
                        account = await this.runtime.account.getAccountByPublicKey(body.multisigAccountPublicKey);
                    }
                    catch (err)
                    {
                        return cb(err);
                    }

                    if (!account) {
                        return cb("Multisignature account not found");
                    }
            
                    if (!account.multisignatures) {
                        return cb("Account does not have multisignatures enabled");
                    }
            
                    if (account.multisignatures.indexOf(keypair.publicKey.toString('hex')) < 0) {
                        return cb("Account does not belong to multisignature group");
                    }
            
                    var requester;
                    try
                    {
                        requester = await this.runtime.account.getAccountByPublicKey(keypair.publicKey);
                    }
                    catch (err)
                    {
                        return cb(err);
                    }

                    if (!requester || !requester.public_key) {  //wxm block database
                        return cb("Invalid requester");
                    }
          
                    if (requester.second_signature && !bignum.isEqualTo(requester.second_signature, 0) && !body.secondSecret) {  //wxm block database
                        return cb("Invalid second passphrase");
                    }
          
                    if (requester.public_key == account.public_key) { //wxm block database
                        return cb("Invalid requester");
                    }

                    let second_keypair = null;
                    if (requester.second_signature && !bignum.isEqualTo(requester.second_signature, 0)) {    //wxm block database
                        var secondHash = crypto.createHash('sha256').update(body.secondSecret, 'utf8').digest();
                        second_keypair = ed.MakeKeypair(secondHash);
                    }

                    try
                    {
                        var transaction = await this.runtime.transaction.create({
                            type: AssetTypes.TRANSFER,
                            amount: body.amount,
                            sender: account,
                            recipient_id: recipientId,
                            keypair,
                            requester: keypair,
                            second_keypair,
                            message: body.message
                        });
                        var transactions = await this.runtime.transaction.receiveTransactions([transaction]);
                        cb(null, transactions);
                    }
                    catch (err)
                    {
                        cb(err);
                    }
                } else {
                    this.logger.debug('publicKey is: ', keypair.publicKey.toString('hex'));

                    var account;
                    try
                    {
                        account = await this.runtime.account.getAccountByPublicKey(keypair.publicKey.toString('hex'));
                    }
                    catch (err)
                    {
                        return cb(err);
                    }
                    if (!account) {
                        return cb("Account not found");
                    }
            
                    if (account.second_signature && !body.secondSecret) {
                        return cb("Invalid second passphrase");
                    }

                    let second_keypair = null;
                    if (account.second_signature) {
                        const secondHash = crypto.createHash('sha256').update(body.secondSecret, 'utf8').digest();
                        second_keypair = ed.MakeKeypair(secondHash);
                    }

                    try
                    {
                        var transaction = await this.runtime.transaction.create({
                            type: AssetTypes.TRANSFER,
                            amount: body.amount,
                            sender: account,
                            recipient_id: recipientId,
                            keypair,
                            second_keypair,
                            message: body.message
                        });
                        var transactions = await this.runtime.transaction.receiveTransactions([transaction]);
                        cb(null, transactions);
                    }
                    catch (err)
                    {
                        cb(err);
                    }
                }
            }, (err, transaction) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({success: true, transactionId: transaction[0].id});
                }
            });
        });
    }

    /**
     * 功能:得到一定时间段内的每天的交易量
     * 参数: 
     *      startTime:2019-6-4;默认为七天前
     *      endTime:2019-6-4;默认为当前时间
     * 返回值:{ "success": true,"data": [{ "time": "2019-6-4", "count": 0 }]}
     */
    async getSpell(req) {
      var query = req.query;
      // 将时间换算成对应格式
      const formatDate = (date) => {
        const y = date.getFullYear();
        let m = date.getMonth() + 1;
        m = m < 10 ? ('0' + m) : m;
        let d = date.getDate();
        d = d < 10 ? ('0' + d) : d;
        return y + '-' + m + '-' + d;
      }
      if (!query.startTime) {
        query.startTime = formatDate(new Date(new Date().getTime() - (1000 * 60 * 60 * 24 * 7)));
      }
      if (!query.endTime) {
        query.endTime = formatDate(new Date());
      }
      // 根据日期字符串得到对应日期的0点的毫秒数
      const getDate = (str) => {
        str = str.toString();
        const strArr = str.split('-');
        const date = new Date(strArr[0], strArr[1] - 1, strArr[2]);
        return date;
      }
      // 获取入参字符串形式日期的Date型日期
      const d1 = getDate(query.startTime);
      const d2 = getDate(query.endTime);
      // 定义一天的毫秒数
      const dayMilliSeconds = 1000 * 60 * 60 * 24;
      // 获取输入日期的毫秒数
      let d1Ms = d1.getTime();
      const d2Ms = d2.getTime();
      // 定义转换格式的方法
      const getYMD = (date) => {
        let retDate = date.getFullYear() + '-'; // 获取年份。
        retDate += date.getMonth() + 1 + '-'; // 获取月份。
        retDate += date.getDate(); // 获取日。
        return retDate; // 返回日期。
      }
      // 定义返回值
      let time;
      const dataArr = [];
      // 对日期毫秒数进行循环比较，直到d1Ms 大于等于 d2Ms 时退出循环
      // 每次循环结束，给d1Ms 增加一天
      for (d1Ms; d1Ms <= d2Ms; d1Ms += dayMilliSeconds) {
        // 将给的毫秒数转换为Date日期
        const day = new Date(d1Ms);
        // 获取其年月日形式的字符串
        time = getYMD(day);
        // 查询当日交易量
        const count = await new Promise((resolve, reject)=>{
            this.dao.count('tr', {
                timestamp: {
                    $gte: Number(this.runtime.slot.getTime(d1Ms)),
                    $lt: Number(this.runtime.slot.getTime(d1Ms + dayMilliSeconds - 1))
                }
            }, null, (err, data) => {
                if(err){
                    reject(err);
                }
                resolve(data);
            })
        })
        const obj = {
          time,
          count,
        };
        dataArr.push(obj);
      }
      return {
        success: true, 
        data: dataArr,
      };

    }
    
}

module.exports = RootRouter;