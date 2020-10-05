const express = require('express');
const app = express();
const port = 3000;
const pdf = require('pdf-parse');
const excelFile = require('read-excel-file/node');
let nodeMailer = require('nodemailer');;

var Imap = require('imap');
var MailParser = require('mailparser').MailParser;
var fs = require('fs');

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

                    //从这里开始, mailparser才开始真正起作用
                   // 邮件头内容
                    // mailparser.on("headers", function(headers) {
                    //     console.log("邮件头信息>>>>>>>>>>>>>>>>>>>>>>>>>>>");
                    //     console.log("邮件主题:" + headers.get('subject'));
                    //     console.log("发件人"+ headers.get('from').text);
                    //     console.log("收件人" + headers.get('to').text);
                    // });
                   
                    // 邮件内容 

                    mailparser.on('data', function(data) {
                        if(data.type === 'attachment' && data.contentType =="application/pdf"){ // this data is an attachment obejct
                           console.log('find attachment')
                            //console.log(data.content)// content is a Buffer that contains the attachment contents
                           data.content.pipe(fs.createWriteStream(data.filename)); // 保存附件到本地文件夹
                           data.release();
                        };

                    });


                    // mailparser.on("data", function(data) {
                    //     if(data.type === 'text') {//邮件正文 text indicates that this object indcludes the html and text parts of the message. 
                    //         console.log("邮件内容信息>>>>>>>>>>>>>>>>>>>>>>>>>>>");
                    //        console.log("邮件名称：" + data.text); // or data.html
                    //     }
                    //     if(data.type === 'attachment') {// 附件
                    //         console.log(("邮件附件信息>>>>>>>>>>>>>>>>>>>>>>>>>>>"));
                    //         console.log(("附件名称" + data.filename));// 打印附件的名称
                    //         // data.content.pipe(fs.createWriteStream(data.filename)); // 保存附件到本地文件夹
                    //         data.release();
                    //     }
                    // });
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

//默认情况下抓取邮件后服务器的邮件状态为未读，如果要在抓取后让邮箱服务器中的邮件状态变为已读，可以修改为：
// var f = imap.fetch(results, { bodies: '' });

// f = imap.fetch(results, { bodies: '', markSeen: true});


// api for send an email by using SMTP protocol(nodemail library)
app.get('/send', function(req, res) {
    let myEmail = '';
    let password = '';

    let transport = nodeMailer.createTransport({
        //service: '163',
        host: 'smtp.gmail.com',
        secure: true,
        auth: {
            user: myEmail,
            pass: password
        }
    });
    
    // 这段代码会和message object里面的text和attachments 属性产生冲突，使得邮箱无法添加附件
    // let sendHtml = `
    //     <div>
    //         <h1> 这是来自${myEmail} 的问候<h1>
    //     </div>
    //    `;

    let message = {
        from: myEmail,
        to: '',
        subject: 'regard from 163, a email server test',
        text: 'this is a prototype test',
       // html: sendHtml,
        //TO DO： 添加更多不同类型的附件，以及如果通过path来添加本地附件
        attachments: [
            {
                filename: 'content.txt',
                content: '发送内容'
            }    
        ]
    };

    transport.sendMail(message, function(err) {
        if(err) {
            console.log('fail to send email');
            console.log(err)
            return;
        }
        console.log("email sent");
        res.send('邮件成功发送')
    });

});

// api for require a PDF file from local folder and parse it to read the text within
app.get('/readPDF/:filename', function(req, res) {
        // default render callback
    function render_page(pageData) {
        //check documents https://mozilla.github.io/pdf.js/
        let render_options = {
            //replaces all occurrences of whitespace with standard spaces (0x20). The default value is `false`.
            normalizeWhitespace: false,
            //do not attempt to combine same line TextItem's. The default value is `false`.
            disableCombineTextItems: false
        }
    
        return pageData.getTextContent(render_options)
        .then(function(textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY){
                    text += item.str;
                }  
                else{
                    text += '\n' + item.str;
                }    
                lastY = item.transform[5];
            }
            return text;
        });
    }
    
    let options = {
        pagerender: render_page
    }
    let dataBuffer = fs.readFileSync('./' + req.params.filename);
    if(dataBuffer) {
        //console.log('find the data buffer');
        pdf(dataBuffer, options).then(function(data) {
           //ç console.log(data.numpages);
            //console.log(data.info);
            console.log(data.text);
            res.send(data.text);
          })
          //.then(() => res.send("it works"))
          .catch(err => console.log(err));
    };

});

//api for require a excel file from local folder and parse it to read the data within
app.get('/readExcel/:filename', function(req, res) {
    let path = './' + req.params.filename;

    excelFile(path).then((rows) => {
        //console.log("work here")
        console.log(rows);
        console.table(rows);
    })
    .catch(err => console.log(err));

});


// 开启express server 并监听相关的端口
app.listen(port, () => {
    console.log(`exmaple all listening at http://localhost:${port}`)
});


