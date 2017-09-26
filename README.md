Server Monitor
==========

:milky_way: A simple host/client application that allows a remote user to monitor various server statistics, such as uptime/downtime and access logs, as well as create and maintain Amazon Glacier backups.

![Screenshot 1](http://superhawk610.myddns.me/share/server-monitor-1.png)

![Screenshot 2](http://superhawk610.myddns.me/share/server-monitor-2.png)

![Screenshot 3](http://superhawk610.myddns.me/share/server-monitor-3.png)

## Installation

`git clone https://github.com/superhawk610/server-monitor.git`

## Configuration

You will need to configure the app using the included `site.config-TEMPLATE`. Copy this to `site.config` and change the values to connect to your own MongoDB server. This monitor also connects to a MySQL database to check for users, and assumes the credentials will be the same. `api_key` can be any unique value, it is simply to deter brute force attacks against your API.

    cp site.config-TEMPLATE site.config
    vim site.config

You will also need to configure your server with your AWS credentials, if you have not already done so. To do so, copy the credentials-TEMPLATE to `~/.aws` and edit the values to reflect your AWS account.

    # name this credentials and place this file in ~/.aws
    [default]
    aws_access_key_id = YOUR_ACCESS_KEY_ID
    aws_secret_access_key = YOUR_SECRET_ACCESS_KEY

If you do not have an access key or secret access key, create a new identity under AWS IAM [here](https://console.aws.amazon.com/iam/home?region=us-east-2#/home).

Finally, if you are using a Glacier server in a region other than `us-east-2`, make sure to change the value in `index.js` to reflect that.

## Usage

This suite provides a handful of useful tools for maintaining a small-scale single server setup, a LAN, and an Amazon Glacier account for backups. These tools and their usage instructions follow:

### Access Control

*TO-DO: Write usage instructions*

### Device Status

*TO-DO: Write usage instructions*

### User Monitoring

*TO-DO: Write usage instructions*

### Glacier Backups

*TO-DO: Write usage instructions*