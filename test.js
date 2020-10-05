const express = require('express');
const app = express();
const port = 3000;

var Imap = require('imap');
var MailParser = require('mailparser').MailParser;
var fs = require('fs');
const _ = require("lodash");
const aws = require('aws-sdk');
const config = require("./config");


aws.config.update({
    accessKeyId: config.awsAccessKeyID,
    secretAccessKey: config.awsSecretAccessKey,
    region: config.awsRegion
});

    let pdfContent = null;
    let pdfFileName = null;

    var imap = new Imap({
        user: '', // 邮箱账号
        password: '', //邮箱密码
        host: 'imap.gmail.com', //邮箱服务器的主机地址
        port: 993, // 邮箱服务器的端口地址
        tls: true, // 使用安全传输协议
        //tlsOptions: { rejectUnauthorized: false} // 禁用对证书有效性的检查
    });

    // 打开收件箱的函数,  其中的cb是一个被当作参数传入的函数
    // cb就是callback function
    // callback make sure that a function is not going to run before a task is completed but will fun right after the task has completed. 
    // callback helps develop asynchronous Javascript codes
    function openInbox(cb) {
        imap.openBox('INBOX', true, cb);
    };

    //imap连接到邮箱服务器后的操作指令
    imap.once('ready', function(){
        openInbox(function(err, box) {
            console.log('打开邮箱')
            if(err) throw err;
            // 搜寻2020-08-12以后的未读邮件
            imap.search(['UNSEEN',['SINCE', 'September 2, 2020']], function(err, results) {   
                if(err) throw err;
                var f = imap.fetch(results, {bodies: ''});// 抓取邮件（默认情况下邮件服务器的邮件是未读状态）
                
                f.on('message', function(msg, seqno){
                    
                    var mailparser = new MailParser();
                    
                    msg.on('body', function(stream, info){
                        // 将为解析的数据流pipe到mailparser
                        stream.pipe(mailparser);

                        mailparser.on('data', function(data) {
                            if(data.type === 'attachment' && data.contentType =="application/pdf"){ // this data is an attachment obejct
                              //console.log(data.content)// content is a Buffer that contains the attachment contents
                               data.content.pipe(fs.createWriteStream(data.filename)); // 保存附件到本地文件夹
                               pdfContent = data.content
                               pdfFileName = data.filename
                               data.release();
                            };
                        });
                    });
                    // 这里的msg 和seqno都是由f obejct 生成的, 而f是从imap 接口调用而来
                    // msg.once('end', function(){
                    //     console.log(seqno + '完成');
                    // });

                });
                
                f.once('error', function() {
                    console.log('抓取出现错误' + err);
                });
                
                f.once('end', function(){
                    console.log('所有邮件抓去完成');
                    imap.end();
                });

            });
        });
    });

    imap.once('error', function(err) {
        console.log(err);
    });

    imap.once('end', function(err) {
        console.log('关闭邮箱');
    });

    imap.connect();

app.get('/fetchPDF', function(req, res) {
       var fileContent = fs.readFileSync("./" + pdfFileName);
       //create aws s3 object
       const s3 = new aws.S3
       const params = {
           Bucket: 'textract-cargo-sprouts',
           Key: pdfFileName,
           Body: fileContent
       }
       // 调用s3 object上传文件
       s3.upload(params, async function(err, data){
            if(err) {
                throw err;
            }
            console.log(`File uploaded successfully. ${data.Location}`);
            getPdfData(pdfFileName)
            
       })

});

aws.config.update({
    accessKeyId: config.awsAccessKeyID,
    secretAccessKey: config.awsSecretAccessKey,
    region: config.awsRegion
});

const textract = new aws.Textract();

const getText = (result, blocksMap) => {
    let text = "";

    if (_.has(result,  "Relationships")) {
        result.Relationships.forEach( relationship => {
            if (relationship.Type === "CHILD") {
                relationship.Ids.forEach( childId => {
                    const word = blocksMap[childId];
                    if(word.BlockType === "WORD") {
                        text += `${word.Text}`;
                    }
                    if(word.BlockType === "SELECTION_ELEMENT") {
                        if(word.SelectionStatus === "SELECTED") {
                            text += `X `;
                        }
                    }
                });
            }
        });
    }

    return text.trim();
};

const findValueBlock = (keyBlock, valueMap) => {
    let valueBlock;
    keyBlock.Relationships.forEach(relationship => {
        if(relationship.Type === "VALUE") {
            relationship.Ids.every(valueId => {
                if(_.has(valueMap, valueId)) {
                    valueBlock = valueMap[valueId];
                    return false;
                }
            });
        }
    });

    return valueBlock;
};

const getKeyValueRelationship = (keyMap, valueMap, blockMap) => {
    const keyValues = {};

    const keyMapValues = _.values(keyMap);

    keyMapValues.forEach(keyMapValue => {
        const valueBlock = findValueBlock(keyMapValue, valueMap);
        const key = getText(keyMapValue, blockMap);
        const value = getText(valueBlock, blockMap);
        keyValues[key] = value;
    });

    return keyValues;
};

const getKeyValueMap =  blocks => {
    const keyMap = {};
    const valueMap = {};
    const blockMap = {};

    let blockId;
    blocks.forEach(block => {
        blockId = block.Id;
        blockMap[blockId] = block;

        if(block.BlockType === "KEY_VALUE_SET") {
            if(_.includes(block.EntityTypes, "KEY")) {
                keyMap[blockId] = block;
            } else {
                valueMap[blockId] = block;
            }
        }
    });
    return { keyMap, valueMap, blockMap};
};

async function getPdfData (fileName) {
    const params = {
        DocumentLocation: { 
            S3Object: { 
                Bucket: "textract-cargo-sprouts",
                Name: fileName,
            }
            },
            FeatureTypes: ["FORMS"],
            NotificationChannel: {
                SNSTopicArn: "",
                RoleArn: "",
            },
        }
    const request = textract.startDocumentAnalysis(params);
    // TODO:
    const jobIdObject = await request.promise().catch(error => console.log(error));
    //jobIdObject.JobId

    const sqs = new aws.SQS();
    const queueUrl = ''

    //set up the receiveMessage parameters
    const paramsReceiveMessage = {
    QueueUrl : queueUrl,
    MaxNumberOfMessages: 1,
    VisibilityTimeout: 0,
    WaitTimeSeconds: 0
    } ;

    let receiveMessage = sqs.receiveMessage(paramsReceiveMessage).promise();
    receiveMessage
    .then((data) => {
            const orderData = JSON.parse(data.Messages[0].Body);
        // console.log(orderData.Message)
            return orderData.Message
    })
    .then(async (data) =>{
        if(data) {
            // TODO: 进行优化以使得jobId取自data本身，符合真实的应用场景
            const params_2 = {
                JobId:""
            };
            const request_2 = textract.getDocumentAnalysis(params_2);
            const data_2 = await request_2.promise().catch(error => console.log(error));
           // console.log(data_2)
         
             if (data_2 && data_2.Blocks) {
                 const { keyMap, valueMap, blockMap } = getKeyValueMap(data_2.Blocks);
                 const keyValues = getKeyValueRelationship(keyMap, valueMap, blockMap);
         
                 console.log(keyValues);
             };
             //in case no blocks are found return undefined 
             //console.log(undefined);
        };

        let containerNumber = 'TGHU8666330'
        return containerNumber
    })
    .then((containerNumber) => {
        console.log(containerNumber)
        const axios = require('axios');
        axios.get('http://127.0.0.1:5000/')

    })

};



// 开启express server 并监听相关的端口
app.listen(port, () => {
    console.log(`exmaple all listening at http://localhost:${port}`)
});
